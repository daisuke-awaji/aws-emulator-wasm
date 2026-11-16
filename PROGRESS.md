# PROGRESS

## 2026-11-15 Phase 0
- `wasm32-wasip1` 向け `cargo check` が DynamoDB・SQS の閉包（13 サービス）で exit 0。詳細は docs/phase0-report.md。

## 2026-11-16 Phase 0.5（完了）
- リポジトリを public に変更（ユーザー）。
- `crates/wasm-host`：13 サービスを登録する router と C ABI（`emu_alloc` / `emu_handle` / `emu_response_ptr` / `emu_response_len` / `emu_tick`）。`fetch-upstream.sh` が上流の `wasm-host/` にコピーし、workspace に足す。
- ローカル：`cargo check --target wasm32-wasip1 -p aws-emulator-wasm-host` が exit 0（6 分 2 秒）。release ビルドはディスク不足のため CI で行う。
- `js/`：フレームの codec、Node の WASI ローダー、SDK v3 の request handler、テスト（codec 5 件はローカルで pass、SDK 往復は CI で `EMULATOR_WASM` を指定して実行）。
- `.github/workflows/wasm.yml`：ビルド → wasm-opt → サイズ計測 → Node テスト → artifact。
- CI run 43802720211（`a0198d5`）：success。`cargo build` 8 分 14 秒。raw 53.7 MB / wasm-opt 26.6 MB（brotli 5.9 / 5.4 MB）。Node で SDK 往復 8 テスト pass（両方の版）。
- DescribeTable の約 3 秒は上流の仕様（作成後 3 秒は CREATING、DescribeTable は ACTIVE まで待つ）。
- 結果は docs/phase05-report.md。

## 2026-11-16 Phase 1（完了）
- `js/src/wasi.mjs`：WASI preview1 の自前シム（16 関数、未実装は ENOSYS）。待ちは仮想時計を進めて即座に返す（既定）。
- `js/src/browser/`：Worker で wasm を動かす `createEmulator()`。SDK の `requestHandler` はブラウザでは ReadableStream の本文を返す（S3 GetObject のチェックサム検証のため）。
- S3 の往復を追加（CreateBucket・PutObject・GetObject・ListObjectsV2・DeleteObject）。Node 17 テスト pass（cargo build 版と wasm-opt 版の両方）。
- `demo/`：Vite + React + MSW（v3）の Todo。DynamoDB（Todo）、S3（メモ）、SQS（変更の記録）。Playwright 12 テスト（デスクトップ・Pixel 7）pass。
- GitHub Pages を有効化（build_type=workflow、API で設定）。run 43812560700（`011f166`）で build・browser・deploy すべて success。
- 公開サイトを手元の Chromium で確認：Todo 表示まで 1.0〜1.3 秒、通信先は github.io だけ、例外 0 件。wasm の転送量は gzip で 8.8 MiB。
- つまずき：cargo build 版は `fd_seek` を import する（wasm-opt 版にはない）。シムに足し、未知の関数は ENOSYS にした。
- 結果は docs/phase1-report.md。

## 2026-11-16 構成図
- Todo デモの構成図を、アイコン付きの図（`demo/src/Architecture.jsx`）に置き換えた。AWS のサービスは AWS Architecture Icons（2026-07-31 版、48 px）、ほかは lucide-react。
- 幅 600 px 以上では 3 つの箱を横に並べ、エミュレーターへは真下に 1 本の矢印。狭い画面では縦に並べ、矢印はすべて下向きの直線（折れ線なし）。
- エミュレーターの状態（読み込み中・動作中・失敗）を色の点で示す。
- Playwright に構成図のテストを追加（矢印と箱が重ならないことも確かめる）。14 テスト pass。

## 2026-11-16 SDK の呼び出し回数、Vercel 風の画面、内部のアーキテクチャ図
- 「Todo を追加すると SDK の呼び出しが 15 回」の原因：表示は起動からの累計で、起動時の準備の 13 回に、追加の 2 回（PutItem・SendMessage）を足した値だった。さらに `GET /api/emulator` を一覧・変更の記録の読み直しと並行に呼んでいたため、読み直しの 4 回（Scan・ReceiveMessage・DeleteMessageBatch・ReceiveMessage）が数に入る前の値を表示していた。追加 1 回で実際に呼ぶのは 6 回。
- 直したこと：読み直しを順番に行い、カウンターは最後に読む。`createEmulator` に `onCall` を足し、操作ごとの呼び出しを「SDK の呼び出し」欄に出す（API ごとの印付き）。「直前の操作」の回数も出す。
- 画面を Vercel（Geist）風に作り直した。Geist と Geist Mono（OFL）を同梱し、外部へのリクエストはなし。ライトとダークの両方。
- 内部のアーキテクチャ図を draw.io で作った（`docs/architecture/architecture.drawio`、`scripts/architecture.py` が生成し、直線であることと重なりがないことを確かめる）。README に PNG を貼った。
- Playwright 18 件（9 テスト × デスクトップ・スマートフォン）pass、Node 17 件 pass。

## 2026-11-16 Todo の操作ごとに SDK の実行を出す
- Todo を操作すると、その Todo の下に、実行した SDK（例：`docs.send(UpdateCommand)`、`sqs.send(SendMessageCommand)`）が出る。行を開くと入力と出力（エラーならその名前と文）。追加と削除は入力欄の下。読み直しの呼び出しは「画面の読み直し」にまとめた。下の「SDK の呼び出し」欄の行も同じように開ける。
- 仕組み：各クライアントの `send` を包んでコマンド名・入力・出力を残し、HTTP 要求の `x-demo-sdk-call` ヘッダーで onCall の応答と結び付ける。コマンド名は SDK の `context.commandName` から取る（ビルドでクラス名が縮むため）。lib-dynamodb のコマンドは PutItemCommand → PutCommand のように戻す。
- e2e：Todo の一覧は直下の li だけを数えるようにした（Todo の下の SDK の行も li のため）。新しいテスト 1 件（完了・メモを開く〔NoSuchKey〕・メモを保存・名前の変更が弾かれる〔0 回〕・削除・閉じる）。Playwright 20 件 pass。

## 2026-11-16 Todo の下の SDK の表示を取りやめ
- ユーザーの判断で、Todo の直下（と入力欄の下）に出していた SDK の実行は外した。「SDK の呼び出し」欄の行を開くと入力と出力が見られる部分と、操作名に Todo の題名を付ける部分は残した。
- e2e は欄の行を開いて入力・出力を確かめるテストに置き換え、Todo の下に何も出ないことも確かめる。Playwright 20 件 pass。

## 2026-11-16 永続化の検討
- docs/persistence-design.md。方式は「wasm のメモリをまるごと保存して書き戻す」を推す。上流のエンジンには書き出しの機能がなく、状態の型に serde もないため。
- Node の実験（js/experiments/）：書き戻した新しいインスタンスで、DynamoDB・S3・SQS の中身が残る。別のプロセスでも読める。メモリは 19 MiB（gzip 2.8 MiB、84 ms）。mutable な global は `__stack_pointer` だけ。
- 単調時計を引き継がないと、保存した時刻が未来になって壊れる（Scan が ResourceNotFound）。単調時計を UNIX 時刻基準にし、`skippedNs` を引き継ぐと直る。
- 決めること：方式、複数タブ（Web Locks で 1 タブだけ）、wasm が変わったときの扱い、保存の契機。
