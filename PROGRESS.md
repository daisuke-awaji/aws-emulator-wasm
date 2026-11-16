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
