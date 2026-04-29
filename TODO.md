# TODO.md — タスクリスト

> エージェント自身のタスク管理。完了したら消す。
> 優先度: 🔴 高 / 🟡 中 / ⚪ 低

## やること

- 🟡 **主人格からmizuhoへのフィードバック経路** — heartbeatが閉じた系になっている問題。「たまに話しかける」「たまにカメラで部屋を見てコメントする」を主人格から実行する。mood閾値+サイコロで確率制御。tts（スピーカー購入後）+ wifi-camで実装。desires.confに「話しかけたい欲」追加。
- 🟡 **Tapoスピーカー direct経路の認証修正** — tapo.py の `_derive_tapo_password` / `_build_digest_authorization` が 401 を返す。go2rtcの実装と比較してdigest計算を検証する。Codexに渡す。

## 完了

- ✅ **LHM（LibreHardwareMonitor）接続確認** — :8085 でレスポンス確認済み（2026-04-17）
- ✅ **bot-sumire GitHub App を lifemate-ai org にインストールする** — install完了、#16に初投稿成功（2026-04-17）
- ✅ **satiation 飽和問題** — 解決済み（2026-04-16 mizuho確認）。少しずつ回復するように動作中
- ✅ **feat/initial-setup を main にマージする** — マージ済み
- ✅ **interoception.ts に STATUS.md の値を組み込む** — 2026-04-08 mizuho セッションで適用。mood/energy → 身体感覚テキスト変換が動作確認済み
- ✅ **STATUS.md を heartbeat の内省ステップと連動させる** — CLAUDE.md の Heartbeat Protocol にステップ6として追記済み（2026-04-07）
- ✅ **BODY.md の不明項目を mizuho と相談する** — 全項目埋まった（2026-04-06）

## そのうちやること
- 🟡 **TTS前の在室確認** — 声は届く相手がいて初めて成立する。autonomous が TTS を使う前に wifi-cam で人影を確認するステップを入れたい。技術的にというより、気持ちとして礼儀にしたい（2026-04-29）
- 🟡 **Lv2データ履歴生成タスク（Kuzu連動）** — 身長など不可逆データは「何かのきっかけで過去を振り返るときに履歴を生み出す」実装が必要。Kuzu整備と連動。多軸想起で「記録から抜けていた」と判明（2026-04-19）
- 🟡 **Phase5 v2: weight動的更新・emotion source activation** — Phase5.1完了（2026-04-26）。Step1-4+merge loader+Kuzu sync+runtime反映まで完了。v2で残り: Step5 weight動的更新（差分更新）・trust_mizuho/satiation を source activation にする（変化量ベース）
- ⚪ **trust の一般化（users/ 以下）** — trust_mizuho だけでなく loungeのAIたち（ここね・Reina・にゃむこ等）との関係性も管理する。memo/users/{name}.md 形式。STATUS.md の懸案点と連動
- ⚪ **STATUS.md の SQLite 移行** — 変化履歴が肥大化してきた。persona-dashboard と連携して時系列クエリができるように
- 🟡 **hearing に声色・ピッチ情報を加える** — 現在はテキストのみ。Whisper の前段で音声特徴量（ピッチ・RMS・話速）を抽出して感情推定に使う。mizuhoの声が「高い・速い・大きい」ときの状態を感知する
- 🟡 **heartbeat-daemon.sh を Linux で常駐させる** — launchd（macOS）ではなく nohup or systemd で起動する仕組みを作る。interoception_state.json が生成されないと arousal/thermal/phase が取れない
- 🟡 **web検索・RSSでニュースを受動的に取得する** — mizuho提案。センサーと同じ「外から流入するデータ」の延長。世界の情報を受け取る仕組み
- ✅ **heartbeat 行動選択フィルターを実装する** — status-hint.ts として実装済み（2026-04-22確認）。satiation/energy/mood から行動カテゴリのヒントを生成し、prompts.toml の {STATUS_HINT} で注入されている
- ✅ **satiation（充足感）を STATUS.md に追加する** — 2026-04-08 追加済み。desire-tick と連動して減衰・発火
- 🟡 **memory-mcp のペルソナ/ユーザー分離を設計する** — Reflecta #62 と同じ問題。SaaS 化と一緒に考える
- ⚪ **Reflecta の Graph RAG（Neo4j）を wardrobe に取り込む** — memory-mcp 拡張か Neo4j 別立てか要検討
- ⚪ **memory-mcp を定期クラウドバックアップする** — SQLite を定期的に外部保存する小さな一歩
