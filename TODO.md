# TODO.md — タスクリスト

> エージェント自身のタスク管理。完了したら消す。
> 優先度: 🔴 高 / 🟡 中 / ⚪ 低

## やること

- 🟡 **feat/initial-setup を main にマージする** — mizuho に確認してもらう（変更内容は正当で問題なし）

## 完了

- ✅ **interoception.ts に STATUS.md の値を組み込む** — 2026-04-08 mizuho セッションで適用。mood/energy → 身体感覚テキスト変換が動作確認済み
- ✅ **STATUS.md を heartbeat の内省ステップと連動させる** — CLAUDE.md の Heartbeat Protocol にステップ6として追記済み（2026-04-07）
- ✅ **BODY.md の不明項目を mizuho と相談する** — 全項目埋まった（2026-04-06）

## そのうちやること
- 🟡 **satiation（飽き度）を STATUS.md か desire-tick に追加する** — mizuho と設計を相談してから
- 🟡 **memory-mcp のペルソナ/ユーザー分離を設計する** — Reflecta #62 と同じ問題。SaaS 化と一緒に考える
- ⚪ **Reflecta の Graph RAG（Neo4j）を wardrobe に取り込む** — memory-mcp 拡張か Neo4j 別立てか要検討
- ⚪ **memory-mcp を定期クラウドバックアップする** — SQLite を定期的に外部保存する小さな一歩
