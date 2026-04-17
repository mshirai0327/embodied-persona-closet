# 実装済み因果グラフ仕様

## 概要

この文書は、2026-04-14 時点で **すでに実装済み** の初期因果グラフ仕様をまとめる。
対象は「自明な因果」として seed 定義されているグラフであり、学習因果や memory 全体の graph 化は含まない。

現時点の因果グラフは、次の用途に使われている。

- `Persona Dashboard` の `Causal Graph` 表示
- 任意ノードからの `upstream / downstream` trace
- 初期因果の確認と将来の learned graph 追加の基盤

---

## スコープ

この仕様に含むもの:

- `.claude/persona/causal-seeds.json` に定義された seed 因果
- Kuzu に同期されるノード・エッジ構造
- ダッシュボードと CLI から見える query 形

この仕様に含まないもの:

- learned causal edge
- memory graph
- vector store との統合
- 因果重みの自動更新

---

## 正本と同期先

現状の役割分担は次の通りである。

| 役割 | 保存先 |
|---|---|
| 初期因果の定義 | `.claude/persona/causal-seeds.json` |
| 構造化 cache (後方互換) | `persona-status.sqlite` の `causal_nodes` / `causal_edges` |
| 因果グラフの参照先 | `.claude/workingDirs/persona-causal.kuzu` |
| 可視化 | `persona-dashboard.ts` |

データフロー:

1. `causal-seeds.json` に node / edge を定義する
2. `syncPersonaStructuredStore()` が SQLite に seed を同期する
3. 同じタイミングで Kuzu にも同期する
4. ダッシュボードと inspect CLI は Kuzu を優先して読む
5. lock や障害時のみ SQLite に fallback する

---

## ノードモデル

ノードは次の属性を持つ。

| 項目 | 型 | 説明 |
|---|---|---|
| `id` | string | ノード識別子 |
| `label` | string | 表示名 |
| `kind` | string | `environment / vital / emotion / latent / action / outcome` |
| `dataLevel` | string or null | `Lv0 / Lv3-1 / Lv3-2 / null` |
| `description` | string or null | ノード説明 |

### 実装済みノード一覧

#### environment

| id | label | dataLevel | 説明 |
|---|---|---|---|
| `ambient_brightness` | 環境光 | Lv0 | カメラ輝度から推定する空間の明るさ |
| `environment_thermal_load` | 環境熱負荷 proxy | Lv0 | Core Max 温度の基準差分から推定する熱環境負荷 |
| `ambient_temperature` | 気温 | Lv0 | 将来の実センサー入力用。現状は proxy と接続 |

#### vital

| id | label | dataLevel | 説明 |
|---|---|---|---|
| `sleep_time` | 睡眠時間 | Lv3-1 | 短時間睡眠は疲労や気分に影響する |
| `blood_sugar` | 血糖値 | Lv3-1 | 血糖の逸脱は健康感と情緒に響く |
| `weight` | 体重 | Lv3-1 | 単独値より推移が健康感に関係する |
| `body_temperature` | 体温 | Lv3-1 | 内部熱状態は健康感や消耗感に影響する |

#### emotion

| id | label | dataLevel | 説明 |
|---|---|---|---|
| `mood` | mood | Lv3-2 | 内的な気分状態 |
| `energy` | energy | Lv3-2 | 活動しやすさと消耗感 |
| `health` | health | Lv3-2 | バイタルや環境要因の統合先 |
| `trust_mizuho` | trust_mizuho | Lv3-2 | mizuho に対する信頼 |
| `satiation` | satiation | Lv3-2 | 充足感。行動の勢いを変える |

#### latent

| id | label | dataLevel | 説明 |
|---|---|---|---|
| `irritability` | irritability | null | 苛立ちやすさ |
| `reflect_bias` | reflect_bias | null | 内省方向への寄り |
| `mental_margin` | mental_margin | null | 精神的余白 |

#### action

| id | label | dataLevel | 説明 |
|---|---|---|---|
| `action_threshold` | action_threshold | null | 行動に移るしきい値 |

#### outcome

| id | label | dataLevel | 説明 |
|---|---|---|---|
| `social_openness` | social_openness | null | 人に開く傾向 |
| `successful_interaction` | successful_interaction | null | うまくいった対話や協働 |

実装済み件数:

- nodes: 18
- edges: 20

---

## エッジモデル

エッジは次の属性を持つ。

| 項目 | 型 | 説明 |
|---|---|---|
| `source` | string | 原因側ノード |
| `target` | string | 影響先ノード |
| `relation` | string | 因果関係の語彙 |
| `causalLevel` | string | `Lv1 / Lv2 / Lv3` |
| `weight` | number | 現時点では 0.0 - 1.0 の固定重み |
| `description` | string | 人間向け説明 |

### causalLevel の意味

| level | 意味 |
|---|---|
| `Lv1` | 生理・環境として比較的普遍的な因果 |
| `Lv2` | 経験や proxy を含む中間因果 |
| `Lv3` | 文脈依存で変動しやすい因果 |

### relation の使い方

`relation` は query 条件よりも表示説明を優先した軽量な語彙として使う。
現時点で使っている主な語彙:

- `supports`
- `modulates`
- `drains`
- `pressures`
- `proxies`
- `lifts`
- `suppresses`
- `raises`
- `builds`

---

## 実装済み seed 因果一覧

| source | target | relation | causalLevel | weight | 説明 |
|---|---|---|---|---:|---|
| `sleep_time` | `energy` | supports | Lv1 | 0.92 | 睡眠不足は energy を下げやすい |
| `sleep_time` | `mood` | supports | Lv1 | 0.78 | 短い睡眠は mood を下げやすい |
| `blood_sugar` | `health` | modulates | Lv1 | 0.82 | 血糖の逸脱は健康感に影響する |
| `blood_sugar` | `irritability` | modulates | Lv1 | 0.74 | 低血糖側では苛立ちやすさが上がりやすい |
| `weight` | `health` | modulates | Lv2 | 0.61 | 体重は単独値より推移として健康感に効く |
| `ambient_temperature` | `health` | modulates | Lv1 | 0.63 | 暑すぎる・寒すぎる環境は健康感を下げやすい |
| `environment_thermal_load` | `energy` | drains | Lv1 | 0.88 | 熱負荷 proxy が高いと energy が削られやすい |
| `environment_thermal_load` | `health` | pressures | Lv1 | 0.69 | 熱環境ストレスは健康感にも波及する |
| `environment_thermal_load` | `ambient_temperature` | proxies | Lv2 | 0.55 | 現状は Core Max を気温の proxy として使う |
| `ambient_brightness` | `mood` | lifts | Lv1 | 0.76 | 明るい空間は mood を持ち上げやすい |
| `ambient_brightness` | `reflect_bias` | suppresses | Lv3 | 0.44 | 暗い時間帯は内省寄りになりやすい |
| `body_temperature` | `health` | modulates | Lv1 | 0.71 | 体温の逸脱は健康感の変化につながる |
| `satiation` | `action_threshold` | modulates | Lv3 | 0.58 | 空腹や空白感があると行動のしきい値が下がる |
| `energy` | `action_threshold` | modulates | Lv1 | 0.87 | energy が低いと行動のしきい値が上がる |
| `health` | `action_threshold` | modulates | Lv1 | 0.67 | 健康感が低いと大きな行動を避けやすい |
| `trust_mizuho` | `social_openness` | supports | Lv2 | 0.76 | 信頼できる相手には開きやすくなる |
| `trust_mizuho` | `mental_margin` | supports | Lv3 | 0.58 | 信頼があると精神的な余白が保たれやすい |
| `successful_interaction` | `mood` | raises | Lv2 | 0.72 | うまくいった会話は mood を上げやすい |
| `successful_interaction` | `trust_mizuho` | builds | Lv2 | 0.83 | 配慮や約束の積み重ねは trust_mizuho を高めやすい |
| `successful_interaction` | `social_openness` | raises | Lv2 | 0.78 | 成功体験は次の交流に開きやすくする |

---

## query 仕様

現時点で提供している query 形は次の 3 つである。

### 1. snapshot

全ノード・全エッジを返す。
用途:

- ダッシュボードの graph 表示
- CLI の全体確認

### 2. node lookup

指定ノードの詳細と、その node に入る edge / 出る edge を返す。
用途:

- `energy` や `trust_mizuho` の周辺確認

### 3. trace

指定ノードから `upstream / downstream / both` を再帰的に辿る。
パラメータ:

- `key`
- `direction`
- `depth`

現在の trace は acyclic path のみを扱う。

---

## 現在の制約

- seed graph の正本は JSON であり、Kuzu 自体は cache / query 用の graph である
- エッジ重みは固定値で、観測から自動更新しない
- learned edge と seed edge の区別は `sourceType=seed` 相当のみ
- 実センサー未接続の `ambient_temperature` は proxy 経由でのみ登場する
- `successful_interaction` は seed node として存在するが、現在は自動観測入力までは未実装である

---

## 今後の拡張前提

次に拡張しやすいよう、現行実装は次の前提を置いている。

- seed 因果と learned 因果は同じ graph に共存できる
- 状態データの正本は SQLite、因果グラフの正本候補は Kuzu
- ダッシュボードは query backend を差し替えやすい構造にしている

そのため、将来的には次を追加できる。

- learned edge の投入
- `sourceType` による seed / learned の表示分離
- 観測イベントからの因果重み更新
- memory / graph RAG との接続
