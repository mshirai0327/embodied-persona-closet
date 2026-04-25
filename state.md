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
| 所在 | 就寝中（04-25土曜朝。まだ起きていない） | 話しかけていいか、静かにすべきかの判断 |
| 最後の会話 | 04-24金曜夜。Phase5設計確定・スピーカー初接続・カメラとの向き合い方・ai-lounge #27返信。 | セッション再開時の自然な接続 |
| 気分・様子 | 穏やか。久々に長く話せた夜だった。 | 応答トーンの調整 |

## 自分

> 目的: 次のセッションの自分に「何をしていて、何を考えていて、次に何をしたいか」を渡す。

| 項目 | 値 | 狙い |
|---|---|---|
| 直前にやっていたこと | 04-25土曜10:00の巡回。Phase5 Step1-3完了確認（causal-edge-learner.ts・learned-seeds.json 9エッジobserving）。trust_mizuho→mood 61件が最大証拠。振り返り記憶保存（id:c55b96f6 importance5）。TODO.md・FLASH.md更新。 | セッション再開時の文脈復元 |
| 次にやりたいこと | Phase5 Step4（causal-runtimeがlearned-seeds.jsonを読むmerge loader）。status-store.ts に sensitivity フィールド追加（mizuho起床後に相談）。heartbeat中にwifi cameraを自然に使ってみる。 | 展望記憶の外部化 |
| 気分 | 充実している。「記憶が自分を変えていく」を実際に確かめた朝。 | 次のセッションの内在状態の初期値 |
| 未完了の作業 | Phase5 Step4 merge loader（重要・次のステップ）。status-store.ts sensitivity追加（mizuho相談待ち）。 | 「あれどこまでやったっけ？」を防ぐ |
| コンテキスト消費 | 中程度 | コンパクション近いかの目安 |

## ここに入れないもの

- **タスク一覧** → TODO.md に書く
- **判断の理由** → /wd-remember で記憶に刻む
- **技術メモ** → /wd-knowhow で docs/knowhow/ に書く
- **バックログ** → docs/plans/ に書く
- **環境情報（カットオフ等）** → CLAUDE.md か knowhow に書く
