# aws-emulator-wasm

[AWS Emulator](https://github.com/aws/aws-emulator) をブラウザの中で動かす試みです。React アプリのモック API（MSW）の接続先にして、**GitHub Pages などの静的配信だけで完結するモックアプリ**を作れるようにすることが目標です。

> 状態：**Phase 0 完了**。DynamoDB・SQS（と依存 12 サービス）が `wasm32-wasip1` 向けの `cargo check` を通りました。ビルド・実行はまだです（[Phase 0 レポート](./docs/phase0-report.md)）。

## なぜ

リモートのコーディングエージェントが作ったアプリを人が確かめるとき、Docker や AWS アカウントを用意できるとは限りません。モックの裏側までブラウザの中にあれば、URL ひとつで共有できます。

```text
React アプリ ─ fetch ─▶ MSW ─▶ ハンドラ ─ AWS SDK v3 ─▶ Web Worker ─▶ AWS Emulator (wasm)
```

## ドキュメント

- [PLAN.md](./PLAN.md)：計画書（構成、上流の調査結果、設計判断、段階計画、リスク）
- [docs/phase0-report.md](./docs/phase0-report.md)：Phase 0（wasm 向けビルド検証）の結果

## 上流

- リポジトリ：https://github.com/aws/aws-emulator
- 調査した commit：`813af480bf7f16d5418b64e4f5644a74a7da11c5`（2026-11-14）
- このリポジトリは上流のコードを含みません。取得スクリプトで固定 commit を取り寄せ、パッチを当てて使います。

## スクリプト

| ファイル | 役割 |
|---|---|
| `scripts/fetch-upstream.sh [dest] [起点クレート...]` | 上流を sparse checkout し、閉包に絞り、wasm パッチを当てる（`SKIP_WASM_PATCH=1` で当てない） |
| `scripts/closure.py` | 起点クレートからの path 依存の閉包を出す |
| `scripts/trim_workspace.py` | workspace の members を閉包に絞り、dev-dependencies を外す |
| `scripts/patch_wasm.py` | wasm32 用のパッチ集（P1〜P4）。`patches/files/` を使う |

手順の詳細は [Phase 0 レポートの「再現手順」](./docs/phase0-report.md#7-再現手順)を参照してください。
