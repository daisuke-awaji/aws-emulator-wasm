# Phase 0 レポート：wasm32 向けビルド検証（cargo check）

- 実施日：2026-11-15
- 上流：`aws/aws-emulator` commit `813af480bf7f16d5418b64e4f5644a74a7da11c5`（2026-11-14）
- 結論：**DynamoDB と SQS（と依存する 12 サービス）が、`wasm32-wasip1` 向けの `cargo check` を通った**（exit 0）。必要だったのは小さなパッチ 7 か所と、C コンパイラとして wasi-sdk。
- 範囲の注意：**型検査（`cargo check`）だけ**です。コード生成・リンク・wasm のサイズ・実行時の動作は**まだ確かめていません**（「8. 未検証」を参照）。

## 1. 環境

| 項目 | 値 |
|---|---|
| ホスト | Linux aarch64、2 vCPU、メモリ 8GB、ディスク 8.8GB（空きは作業後 約 600MB） |
| Rust | rustc 1.100.0（2026-11-09）、cargo 1.100.0 |
| ターゲット | `wasm32-wasip1` |
| C ツールチェーン | wasi-sdk 34（clang 23.1.0-wasi-sdk） |
| 再現手順 | 「7. 再現手順」 |

## 2. 対象

起点を DynamoDB と SQS にして、path 依存を辿った閉包を取りました（`scripts/closure.py`）。

| 区分 | クレート |
|---|---|
| 起点 | dynamodb、sqs |
| 依存で入るサービス（12） | s3、s3tables、kms、kinesis、dynamodbstreams、iam、sts、cognitoidentityprovider、cloudwatch、cloudhsmv2、wafv2、`services/common` |
| vendor（8） | engine、server、smithy-server-runtime、smithy-schema-server、smithy-macros、emulator-telemetry、emulator-paths、build-support |
| 依存グラフ全体 | 418 クレート（外部クレートを含む、`cargo tree` の重複除去後） |

参考：Lambda を起点にすると、依存サービスは 21 になります（EC2 を含む）。

## 3. 結果の推移

| # | 起きたこと | 原因 | 対処 |
|---|---|---|---|
| 1 | workspace を読み込めない | cloudhsmv2 の `[dev-dependencies]` が EC2 を参照している（閉包の外） | 閉包の中のクレートから dev-dependencies を外す（`trim_workspace.py`） |
| 2 | `aws-lc-sys`・`ring`・`libsqlite3-sys` のビルドスクリプトが失敗 | `clang` が無い | wasi-sdk 34 の clang と sysroot を指定 → **3 つとも C のビルドが通った** |
| 3 | `tokio`: "Only features sync,macros,io-util,rt,time are supported on wasm." | `vendor/server` の `full`、workspace の `rt-multi-thread`、axum の既定 `tokio`（→ `net`）、kinesis の `aws-sdk-kms` の `rt-tokio`（→ aws-smithy-types → `fs`） | wasm では tokio を `sync, macros, io-util, rt, time` に、axum を `default-features = false` にする。kinesis から `rt-tokio` を外す |
| 4 | `emulator-telemetry`：`reqwest::blocking` が無い（7 エラー） | wasm の reqwest には blocking クライアントが無い | wasm では reqwest を外し、同じ名前の代用品（送信は常に失敗）に差し替える |
| 5 | `aws-emulator-server`：14 エラー | `axum_server`、`tokio::net::TcpListener`、`tokio::signal` | ポートを開く・TLS・シグナル処理を wasm では外す。リソース用 listener は「wasm では使えない」というエラーを返す |
| 6 | `service-common`：`compile_error!`（`panic = "unwind"` が必須） | JSONata の評価を `catch_unwind` で囲んでいる。wasm32 は既定で `panic = abort` | wasm ではこの検査を外す（実行時のリスクとして下に記録） |
| 7 | cloudwatch：`tokio::task::block_in_place` が無い | multi-thread ランタイム専用の API | wasm ではその分岐を外す（もともと current-thread では `work()` を直接実行する分岐がある） |
| — | **exit 0**（警告 36 件、多くは cfg で使われなくなった項目） | | `docs/logs/phase0-check-final.txt` |

## 4. パッチ集

- 正本は `scripts/patch_wasm.py`（P1〜P4）と `patches/files/`。
- 参考用の差分が `patches/wasm32.diff`。root `Cargo.toml` の tokio 行の変更は含みません（`trim_workspace.py` の変更と混ざるため）。kinesis の差分には dev-dependencies の削除も入っています。
- どの変更も `cfg(target_family = "wasm")` か、その否定で囲んでいます。ネイティブビルドの挙動は変えない意図ですが、**ネイティブでの再確認はまだ**です。

| ID | 対象 | 内容 |
|---|---|---|
| P1 | root `Cargo.toml`、vendor/server、vendor/smithy-server-runtime、kinesis、cloudwatch | tokio・axum の機能を wasm 用に絞る。`block_in_place` を外す |
| P2 | vendor/emulator-telemetry | reqwest を代用品に差し替える（外部へ送らない） |
| P3 | services/common/jsonata.rs | `panic = abort` での `compile_error!` を wasm では外す |
| P4 | vendor/server（lib.rs、listeners.rs） | 待ち受け・TLS・シグナルを wasm では外す |

## 5. わかったこと

- **C の依存は止める理由にならない。** `wasm32-wasip1` と wasi-sdk なら、aws-lc-sys・ring・SQLite（rusqlite の bundled）のどれもビルドスクリプトが通りました。KMS と Cognito は `aws-lc-rs` と `ring` を直接使っているので、これは大きいです。`wasm32-unknown-unknown` にすると、ここが一番難しくなる見込みです（未確認）。
- **壊れたのはほぼ「サーバー層」だけ。** サービス本体（DynamoDB や SQS の実装）には wasm 向けの修正が要りませんでした。
- **embedded mode の土台は残っている。** `emulator_server::embedded` と `http_connector_call` には手を入れていません。

## 6. 実行時のリスク（コードを読んで見つけたもの）

| リスク | 該当箇所 | 影響と対策案 |
|---|---|---|
| スレッドを作れない（wasip1） | `services/common/src/jsonata.rs` の評価スレッド、telemetry の worker・outbox | JSONata の評価は実行時に失敗する見込み。telemetry は Off にして起動させない |
| `panic = abort` | `vendor/server` の `contain_panics`、jsonata | 1 回の panic で wasm インスタンスが落ちる。Worker が作り直して操作ログを再生する。nightly の `-Zbuild-std` と `panic=unwind`（wasm の例外処理）を別途検証する |
| `tokio::spawn` によるバックグラウンド処理 | DynamoDB の export・import、KMS の create_key など、cloudwatch のアラーム | current-thread ランタイムを、リクエストの合間にも JS 側から進める必要がある（タイマーで定期的に進める設計） |
| ファイル I/O | embedded の home dir 設定、認証情報の書き出し、telemetry の SQLite | WASI シムのメモリ上のファイルシステムで受ける（ブラウザでの動作は未確認） |

## 7. 再現手順

```bash
# Rust と wasm ターゲット
rustup target add wasm32-wasip1
# wasi-sdk（例：arm64 Linux）
gh release download wasi-sdk-34 -R WebAssembly/wasi-sdk -p 'wasi-sdk-34.0-arm64-linux.tar.gz' -O - | tar xz -C /tmp
W=/tmp/wasi-sdk-34.0-arm64-linux
export CC_wasm32_wasip1=$W/bin/clang AR_wasm32_wasip1=$W/bin/llvm-ar CFLAGS_wasm32_wasip1="--sysroot=$W/share/wasi-sysroot"

# 上流を取得し、閉包に絞って、パッチを当てる
scripts/fetch-upstream.sh /tmp/awsemu-p0
cd /tmp/awsemu-p0
cargo check --target wasm32-wasip1 \
  -p service-com-amazonaws-dynamodb-dynamodb-20120810 \
  -p service-com-amazonaws-sqs-amazonsqs
```

`fetch-upstream.sh` を実行し直すと、取得済みの checkout を元に戻してからパッチを当て直します。この手順でも exit 0 を確認しました。

## 8. 未検証（このレポートでは確かめていないこと）

- `cargo build`（コード生成とリンク）、`.wasm` の出力とサイズ。この環境は空きディスクが約 600MB で足りません。
- wasm の実行（Node の WASI、ブラウザの WASI シム）、SDK からの往復。
- パッチを当てた状態でのネイティブビルド（regression）。
- `wasm32-unknown-unknown`。
- Lambda など、ほかのサービスの閉包。

## 9. 次の一手（Phase 0.5）

1. 自前の host クレート（`crates/aws-emulator-wasm`）を作る。`core/router` の仕組みを読み、DynamoDB・SQS と依存サービスだけを登録する router と、`handle(request) -> response` を公開する入口を用意する。
2. `cargo build --release --target wasm32-wasip1` をビルドし、サイズを測る（`wasm-opt -Oz` の前後）。ディスクに余裕のある環境（目安 20GB 以上）が必要。
3. まず Node の `node:wasi` で、SDK v3 の独自 requestHandler から CreateTable、PutItem、GetItem、SendMessage を往復させる。
4. 次にブラウザ（WASI シム + Worker）で同じことを行い、Playwright で確かめる。
5. ネイティブビルドの regression を確認し、`panic=unwind` の可否を検証する。
