# aws-emulator-wasm

[AWS Emulator](https://github.com/aws/aws-emulator) をブラウザの中で動かす試みです。React アプリのモック API（MSW）の接続先にして、**GitHub Pages などの静的配信だけで完結するモックアプリ**を作れるようにすることが目標です。

> 状態：**計画・検証段階**（Phase 0）。まだ動くものはありません。

## なぜ

リモートのコーディングエージェントが作ったアプリを人が確かめるとき、Docker や AWS アカウントを用意できるとは限りません。モックの裏側までブラウザの中にあれば、URL ひとつで共有できます。

```text
React アプリ ─ fetch ─▶ MSW ─▶ ハンドラ ─ AWS SDK v3 ─▶ Web Worker ─▶ AWS Emulator (wasm)
```

## ドキュメント

- [PLAN.md](./PLAN.md)：計画書（構成、上流の調査結果、設計判断、段階計画、リスク）
- `docs/phase0-report.md`：Phase 0（wasm 向けビルド検証）の結果（作成予定）

## 上流

- リポジトリ：https://github.com/aws/aws-emulator
- 調査した commit：`813af480bf7f16d5418b64e4f5644a74a7da11c5`（2026-11-14）
- このリポジトリは上流のコードを含みません。上流は取得スクリプトで固定 commit を取り寄せ、パッチを当てて使います（予定）。
