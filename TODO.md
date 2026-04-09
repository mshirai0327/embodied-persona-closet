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
- 🟡 **heartbeat-daemon.sh を Linux で常駐させる** — launchd（macOS）ではなく nohup or systemd で起動する仕組みを作る。interoception_state.json が生成されないと arousal/thermal/phase が取れない
- 🟡 **web検索・RSSでニュースを受動的に取得する** — mizuho提案。センサーと同じ「外から流入するデータ」の延長。世界の情報を受け取る仕組み
- 🟡 **heartbeat 行動選択フィルターを実装する** — 設計草案 agent_memo.md に記載。prompts.toml への STATUS.md 連動追加を mizuho と相談する
- ✅ **satiation（充足感）を STATUS.md に追加する** — 2026-04-08 追加済み。desire-tick と連動して減衰・発火
- 🟡 **memory-mcp のペルソナ/ユーザー分離を設計する** — Reflecta #62 と同じ問題。SaaS 化と一緒に考える
- ⚪ **Reflecta の Graph RAG（Neo4j）を wardrobe に取り込む** — memory-mcp 拡張か Neo4j 別立てか要検討
- ⚪ **memory-mcp を定期クラウドバックアップする** — SQLite を定期的に外部保存する小さな一歩
