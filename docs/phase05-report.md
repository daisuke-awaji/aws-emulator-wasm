# Phase 0.5 レポート：wasm のビルドと Node での往復

- 実施日：2026-11-16
- 上流：`aws/aws-emulator` commit `813af480bf7f16d5418b64e4f5644a74a7da11c5`
- 結論：**wasm（`wasm32-wasip1`）にビルドしたエミュレーターに、Node の WASI 上で AWS SDK for JavaScript v3 から DynamoDB と SQS を呼び、往復が通った。** wasm-opt をかけた版でも同じテストが通った。
- 根拠：GitHub Actions run [43802720211](https://github.com/daisuke-awaji/aws-emulator-wasm/actions/runs/43802720211)（commit `a0198d5`、success）

## 1. 作ったもの

| 場所 | 役割 |
|---|---|
| `crates/wasm-host` | 13 サービスを登録する router と C ABI。`fetch-upstream.sh` が上流の checkout に `wasm-host/` としてコピーし、workspace に足す |
| `js/src/codec.mjs` | Rust 側と共通のフレーム形式（`u32 個数` に続いて `u32 長さ + バイト列` を並べる） |
| `js/src/emulator.mjs` | Node の `node:wasi` で wasm を読み込み、`fetch(req)` と `tick()` を提供する |
| `js/src/handler.mjs` | SDK v3 の `requestHandler`。SDK のリクエストをフレームにして wasm に渡し、`HttpResponse` にして返す |
| `.github/workflows/wasm.yml` | ビルド → wasm-opt → サイズ計測 → Node テスト → artifact の保存 |

C ABI は次の 5 つです。

| 関数 | 内容 |
|---|---|
| `emu_alloc(len) -> ptr` | リクエストを書き込む領域を確保する |
| `emu_handle(ptr, len) -> len` | リクエストを処理する（領域はここで解放する）。応答の長さを返す |
| `emu_response_ptr()` / `emu_response_len()` | 直前の応答 |
| `emu_tick()` | ハンドラーが起動したバックグラウンドのタスクを少し進める |

処理はすべて 1 本の current-thread tokio ランタイムで行います。認証は off（SDK の署名はサービスの判定にだけ使う）、telemetry は起動しません。

## 2. CI の実測（run 43802720211、キャッシュなしの初回）

| 項目 | 値 |
|---|---|
| ランナー | `ubuntu-24.04`（x86_64） |
| ツール | rustc 1.100.0、wasi-sdk 34、wasm-opt version 133 |
| ビルド設定 | release、`opt-level = "s"`、debug なし、スタック 8MiB（`-zstack-size=8388608`） |
| `cargo build` | 8 分 14 秒 |
| ジョブ全体 | 約 15 分 |

### サイズ

| ファイル | raw | gzip -9 | brotli -q 11 |
|---|---|---|---|
| `cargo build --release` | 53.7 MB | 10.3 MB | 5.9 MB |
| `wasm-opt -Oz` | 26.6 MB | 8.7 MB | 5.4 MB |

### Node 22 での往復（cargo build の版）

| 操作 | 時間 |
|---|---|
| wasm の読み込みとインスタンス化 | 138 ms（wasm-opt 版は 88 ms） |
| CreateTable | 38.4 ms |
| DescribeTable | 2,996 ms（下記） |
| PutItem | 6.2 ms（初回）、1.5 ms（2 回目） |
| GetItem | 2.1 ms |
| Query | 3.4 ms |
| ListTables | 1.8 ms |
| CreateQueue | 5.2 ms |
| GetQueueUrl | 2.5 ms |
| SendMessage | 2.7 ms |
| ReceiveMessage | 2.5 ms |
| DeleteMessage | 1.5 ms |

テストは 8 件すべて pass でした（codec 5 件、SDK 3 件。SDK の 3 件目は「存在しないテーブルは `ResourceNotFoundException` になり、落ちない」）。wasm-opt 版でも同じ 8 件が pass しています。

**DescribeTable の約 3 秒は上流の仕様です。** 上流はテーブルを作ってから 3 秒間 `CREATING` として扱います（`state.rs` の `STATUS_TRANSITION = 3s`）。作成直後の DescribeTable は、`ACTIVE` になるまで `tokio::time::sleep` で待ってから応答します（`ops/describe_table.rs`）。これにより、wasm の中でも tokio のタイマーが WASI の時計で動くことが確かめられました。

## 3. わかったこと

- **wasm32-wasip1 で、SDK から見て普通に動く。** DynamoDB の JSON プロトコル、SQS の JSON プロトコル（SDK v3 の現行）のどちらも通りました。日本語の値も往復しています。
- **1 回の呼び出しは数 ms。** ブラウザで使うには十分な速さの見込みです。
- **サイズは brotli で約 5.4〜5.9 MB。** ブラウザに配るには大きめですが、現実的な範囲です。サイズを詰めるなら、登録するサービスを減らす（今は依存で入る 11 サービスも登録している）か、`opt-level = "z"` と LTO を試すのが次の候補です。

## 4. ブラウザに進む前のリスク

| リスク | 内容 | 対策案 |
|---|---|---|
| 同期で止まる待ち | DescribeTable のように、ハンドラーが `sleep` すると wasm のスレッド全体が止まる。Node では WASI の `poll_oneoff` が止めてくれる | ブラウザでは Worker の中で動かし、WASI シムの `poll_oneoff` を `Atomics.wait` で実装する |
| `spawn_blocking` | Cognito の CreateUserPool、KMS の非対称鍵、DynamoDB の import・export はスレッドを使う | 実行時に失敗する見込み。ブラウザ版の前に、どの操作が失敗するかを洗い出す |
| ファイル I/O | WASI に preopen を渡していないので、ファイルへの書き込みは失敗する（今回のテスト範囲では問題が出なかった） | メモリ上のファイルシステムを渡す |
| panic | `panic = abort` なので、1 回の panic でインスタンスが落ちる | Worker を作り直して操作ログを再生する |

## 5. 再現

- CI：`main` への push、PR、`workflow_dispatch` で `.github/workflows/wasm.yml` が動く。wasm は artifact `aws-emulator-wasm` に保存される（14 日）。
- ローカル（ディスク 20GB 以上が目安）：

```bash
bash scripts/fetch-upstream.sh .upstream
cd .upstream
CARGO_PROFILE_RELEASE_OPT_LEVEL=s \
CARGO_TARGET_WASM32_WASIP1_RUSTFLAGS="-C link-arg=-zstack-size=8388608" \
cargo build --release --target wasm32-wasip1 -p aws-emulator-wasm-host
cd ../js && npm ci
EMULATOR_WASM=../.upstream/target/wasm32-wasip1/release/aws_emulator_wasm_host.wasm npm test
```

C の依存のために、`CC_wasm32_wasip1`・`AR_wasm32_wasip1`・`CFLAGS_wasm32_wasip1` を wasi-sdk に向けてください（Phase 0 レポートの「再現手順」を参照）。

## 6. 次の一手（Phase 1：ブラウザ）

1. ブラウザ用のローダーを作る。Worker の中で `@bjorn3/browser_wasi_shim` を使い、`poll_oneoff` のタイマーを実装する。
2. SDK v3 のブラウザ版から同じ往復テストを流し、Playwright（Chromium）で確かめる。CI にも足す。
3. デモページ（テーブルとキューを操作する画面）を GitHub Pages で公開する。
4. `spawn_blocking` を使う操作の一覧と、その扱いを決める。
