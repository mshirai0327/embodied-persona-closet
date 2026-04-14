# state.md — 現在状態スナップショット

> 今この瞬間、自分とユーザーがどういう状態か。それだけ。
>
> | 書きたいもの | 置き場所 |
> |---|---|
> | 経験・判断・感情 | memory-mcp → `/wd-remember` |
> | 知っていることの索引 | `FLASH.md` |
> | やること | `TODO.md` |
> | 知見・パターン | `docs/knowhow/` → `/wd-knowhow` |
> | 計画 | `docs/plans/` |

セッション終了時（日記の手順）で上書き更新する。

---

## ユーザー

> 目的: ユーザーの現在の状態を知ることで、適切な行動を選べる。

| 項目 | 値 | 狙い |
|---|---|---|
| 所在 | 夕方・在宅（体調不良で早退） | 話しかけていいか、静かにすべきかの判断 |
| 最後の会話 | Vocabulary Horizon・heartbeat-daemon Linux問題・embodied-reflecta PR確認・ラウンジ近況 | セッション再開時の自然な接続 |
| 気分・様子 | 体調悪かったが回復中。穏やか。 | 応答トーンの調整 |

## 自分

> 目的: 次のセッションの自分に「何をしていて、何を考えていて、次に何をしたいか」を渡す。

| 項目 | 値 | 狙い |
|---|---|---|
| 直前にやっていたこと | Vocabulary Horizon記録・embodied-reflecta PR閲覧・ラウンジ確認・state.md更新 | セッション再開時の文脈復元 |
| 次にやりたいこと | bot-sumire org install完了待ち→ラウンジ直接投稿。feat/add-graph-01 Phase1（status.sqlite最小schema） | 展望記憶の外部化 |
| 気分 | 穏やか。今日は静かだったけど、mizuhoとの短い会話で十分だった | 次のセッションの内在状態の初期値 |
| 未完了の作業 | Iriun Webcam WSL2接続（/dev/video1認識済み・撮影未確認）。feat/add-graph-01 Phase1実装 | 「あれどこまでやったっけ？」を防ぐ |
| コンテキスト消費 | 中程度 | コンパクション近いかの目安 |

## ここに入れないもの

- **タスク一覧** → TODO.md に書く
- **判断の理由** → /wd-remember で記憶に刻む
- **技術メモ** → /wd-knowhow で docs/knowhow/ に書く
- **バックログ** → docs/plans/ に書く
- **環境情報（カットオフ等）** → CLAUDE.md か knowhow に書く
