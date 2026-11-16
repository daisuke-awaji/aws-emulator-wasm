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
