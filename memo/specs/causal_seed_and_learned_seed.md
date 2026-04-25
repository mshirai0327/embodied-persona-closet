# causal-seeds / learned-seeds 仕様

> 作成: 2026-04-25
> 対象: `.claude/persona/causal-seeds.json` / `.claude/persona/learned-seeds.json`

## 概要

この文書は、persona の因果グラフを構成する **Lv1因果** と **Lv2因果** の役割、
取得方法、入出力、runtime / context / prompt への接続を整理する。

現行の因果層は大きく分けて次の2種類である。

| 層 | ファイル | 性格 | 現在の主用途 |
|---|---|---|---|
| Lv1因果 | `.claude/persona/causal-seeds.json` | 人間が設計した seed 因果 | runtime 推論、Kuzu trace、dashboard |
| Lv2因果 | `.claude/persona/learned-seeds.json` | memory から抽出された経験起因因果 | 観測・可視化、将来の runtime merge |

ここでの `Lv1 / Lv2` は `BODY.md` や `STATUS.md` の persona level とは別の、
**因果エッジの由来・確からしさ・運用モード**を表す分類である。

---

## Lv1因果: causal-seeds.json

### 位置づけ

Lv1因果は、mizuho が「かなり自明」「基底にしてよい」と判断して手で定義した因果である。
主に環境・バイタルから mood / energy / health へ届く低層の因果を扱う。

例:

```text
ambient_brightness -> mood
environment_thermal_load -> energy
ambient_temperature -> health
sleep_time -> energy
```

### スキーマ

```json
{
  "nodes": [
    {
      "id": "ambient_brightness",
      "label": "環境光",
      "kind": "environment",
      "dataLevel": "Lv0",
      "description": "カメラ輝度から推定する空間の明るさ"
    }
  ],
  "edges": [
    {
      "source": "ambient_brightness",
      "target": "mood",
      "relation": "lifts",
      "causalLevel": "Lv1",
      "weight": 0.76,
      "description": "明るい空間は mood を持ち上げやすい"
    }
  ]
}
```

### weight の与え方

Lv1の `weight` は、現時点では自動学習値ではなく、設計時に与える固定値である。
意味は「その因果エッジそのものの強さ」であり、runtime 時の現在値とは別である。

目安:

| weight帯 | 意味 | 例 |
|---:|---|---|
| `0.80 - 1.00` | 強い・ほぼ基底として扱う | 睡眠不足→energy、熱負荷→energy |
| `0.60 - 0.79` | 中程度に信頼できる | 明るさ→mood、体温→health |
| `0.35 - 0.59` | 弱い・proxy・条件付き | 湿度→mood、熱負荷proxy→気温 |
| `< 0.35` | 原則使わない | まだ seed 化しないほうがよい |

重みは runtime で次のように使われる。

```text
pathScore =
  sourceActivation
  * edgeWeightProduct
  * relationSignProduct
  * depthDecay
```

実装上は `causal-runtime.ts` の `computeCausalPathScore()` が、
path 上の edge weight を掛け合わせ、深さに応じて `DEPTH_DECAY = 0.85` を掛ける。
したがって direct edge は強く、2-hop / 3-hop は自然に弱くなる。

### relation の意味

`relation` は符号と表示説明の両方に使う。

| relation | runtime符号 | 意味 |
|---|---:|---|
| `supports` / `lifts` / `raises` | `+1` | target を支える・上げる |
| `drains` / `pressures` / `lowers` | `-1` | target を削る・圧迫する |
| `proxies` | `+1` | proxy として伝播する |
| `modulates` | `0` | 方向が文脈依存。現行runtimeでは proposal にしない |

`modulates` は「関係はあるが、上げ下げはその時々」という意味なので、
現行 runtime では score 0 として扱われる。

### 入力

Lv1 runtime の主入力は `environment-tick.ts` が集める環境値である。

| sourceId | 取得元 | 正規化 |
|---|---|---|
| `ambient_brightness` | wifi-cam snapshot の ROI 輝度 | ROI baseline との差分から `0-100` |
| `environment_thermal_load` | LHM/Core Max 温度 | EMA baseline との差分から `0-100` |
| `ambient_temperature` | 気象庁 AMeDAS | 気温を `0-100` |
| `ambient_humidity` | 気象庁 AMeDAS | 湿度を `0-100` |

この入力は次の形で `causal-runtime.ts` に渡される。

```ts
{
  sourceId: "ambient_brightness",
  normalizedValue: 76,
  reason: "環境光 76/100 ..."
}
```

### 出力

Lv1 runtime の出力は `CausalStatusProposal[]` である。

```ts
{
  field: "mood",
  score: 0.42,
  delta: 2,
  reason: "環境光 ... Kuzu因果: 環境光 → mood が気分を持ち上げる方向に働いた",
  topPathDescription: "環境光 → mood",
  contributingSources: ["ambient_brightness"]
}
```

この proposal は `environment-tick.ts` で以下に使われる。

1. `STATUS.md` の `mood / energy / health` を `delta` だけ更新する
2. `.claude/workingDirs/causal-runtime.json` に snapshot を保存する
3. 後続の `causal-hint.ts` / `recall-lite.ts` が読む

---

## Lv2因果: learned-seeds.json

### 位置づけ

Lv2因果は、スミレが memory に蓄積した経験から抽出する因果である。
Lv1のように最初から公理として扱うのではなく、
「何度も同じ組み合わせで出てきたので、まず observing として持つ」フラジャイルな因果である。

主な対象は、Phase5 初期スコープでは次の emotion ノードである。

```text
mood / energy / health / trust_mizuho / satiation
```

### スキーマ

```json
{
  "learnedEdges": [
    {
      "id": "learned_trust_mizuho_mood_001",
      "pair": ["mood", "trust_mizuho"],
      "source": "trust_mizuho",
      "target": "mood",
      "direction": "trust_mizuho->mood",
      "relation": "lifts",
      "causalLevel": "Lv2",
      "weight": 0.3,
      "status": "observing",
      "evidenceCount": 61,
      "evidenceMemoryIds": ["..."],
      "evidenceSummary": [
        {
          "id": "...",
          "timestamp": "2026-04-20T19:54:47.823237",
          "valence": "positive",
          "contentSnippet": "mizuhoからの指摘..."
        }
      ],
      "positiveEvidenceCount": 52,
      "negativeEvidenceCount": 3,
      "neutralEvidenceCount": 6,
      "learnedAt": "2026-04-25T00:55:59.701Z",
      "lastUpdated": "2026-04-25T00:55:59.701Z",
      "description": "trust_mizuho から mood への経験起因エッジ候補..."
    }
  ]
}
```

### 取得方法

Lv2因果は `causal-edge-learner.ts` が memory DB を走査して作る。
現行実装では、直近 `200` 件の memory を読み、各 memory から因果ノード候補を推定する。

入力テーブルは memory DB の `memories` と `episodes` で、主に次を読む。

| 入力 | 用途 |
|---|---|
| `memories.content` | 本文からノード・valence を推定 |
| `memories.timestamp` | 時間的先行の推定 |
| `memories.emotion` | positive / negative / neutral の補助 |
| `memories.category` | conversation / daily / technical 等の補助 |
| `memories.tags` | ノード推定の補助 |
| `episodes.participants` | `mizuho` など entity 推定 |
| `episodes.summary` | 本文と合わせてノード推定 |

処理の流れ:

1. `readLearnerMemoryRows()` が memory DB から直近 `200` 件を読む
2. `inferAffectedNodes()` を再利用して memory が触れている因果ノードを推定する
3. `satiation` だけは Phase5 用に追加ヒント語で補う
4. `mood / energy / health / trust_mizuho / satiation` 以外を除外する
5. 同じ memory に2つ以上の対象ノードが出たら、ノードペアの共起証拠にする
6. 同一ペアの証拠数が `5` 件以上なら candidate にする
7. 平均 timestamp の差が `6` 時間以上あれば、早い側を `source`、遅い側を `target` にする
8. 方向が不明なら `direction: "ambiguous"` として保持する
9. positive / negative / neutral の件数から `relation` を決める
10. `--promote-all` などで `learned-seeds.json` へ `observing` として保存する

### relation / weight / status

Lv2 learned edge の初期値は控えめにしてある。

| 項目 | 現行値・規則 | 意味 |
|---|---|---|
| `causalLevel` | `Lv2` | 経験起因因果 |
| `weight` | 初期 `0.3` | observing 中なので弱く効かせる前提 |
| `status` | 初期 `observing` | 確定前の観測中 |
| `relation` | positive > negative なら `lifts` | 正方向の経験が多い |
| `relation` | negative > positive なら `drains` | 負方向の経験が多い |
| `relation` | ambiguous または同数なら `modulates` | 方向・符号が未確定 |

将来的な設計では、heartbeat ごとに新規証拠だけを差分更新し、
証拠なら `+0.05`、反証なら `-0.05`、`0.8` 以上で `confirmed`、
`0` 以下で削除する方針である。
ただし現行コードでは、weight の動的更新はまだ実装されていない。

### 現在の制限

2026-04-25 時点では、Lv2因果は次の状態である。

- `causal-edge-learner.ts` による抽出・pending 作成・observing 昇格は実装済み
- `.claude/persona/learned-seeds.json` は生成済み
- dashboard では Lv1 causal-seed の下に Lv2 learned-seed を別グラフとして可視化する
- ただし `causal-kuzu.ts` / `causal-kuzu-node.mjs` はまだ `causal-seeds.json` 単体を同期する
- したがって、Lv2 learned edge はまだ runtime proposal / prompt 注入には直接効いていない

---

## 保存先と同期先

| データ | 正本 | 派生・cache |
|---|---|---|
| Lv1 seed graph | `.claude/persona/causal-seeds.json` | SQLite `causal_nodes` / `causal_edges`, Kuzu |
| Lv2 learned graph | `.claude/persona/learned-seeds.json` | dashboard payload の `learnedGraph` |
| Lv2 pending candidates | `.claude/workingDirs/pending-learned-edges.json` | 一時レビュー用 |
| runtime snapshot | `.claude/workingDirs/causal-runtime.json` | prompt注入用 |
| causal memory snapshot | `.claude/workingDirs/causal-memory-runtime.json` | prompt注入用 |

---

## runtime の input / output

### input

現行 runtime の入口は環境 sensor である。

```text
sensor / API
  -> environment-tick.ts
  -> EnvironmentCausalSourceInput[]
  -> causal-runtime.ts
```

`causal-runtime.ts` は source ごとに activation を作る。

| source | activation |
|---|---|
| `ambient_brightness` | 40-60 を neutral、暗いと negative、明るいと positive |
| `environment_thermal_load` | 40-60 を neutral、低負荷 positive、高負荷 negative |
| `ambient_temperature` | 高温のみ positive activation として扱い、`drains` で負方向化 |
| `ambient_humidity` | 高湿度のみ positive activation として扱い、`drains` で負方向化 |

### graph read

現行 runtime は Kuzu から downstream path を読む。

```text
sourceId
  -> readKuzuTraceBundle(sourceId, "downstream", 3)
  -> Kuzu path rows
  -> computeCausalPathScore()
```

Kuzu が読めない場合は、SQLite の `causal_nodes` / `causal_edges` に fallback する。
ただし Kuzu / SQLite ともに、現行同期は Lv1 seed graph が中心である。

### output

runtime の主出力は次の2つである。

1. `STATUS.md` 更新
2. `.claude/workingDirs/causal-runtime.json`

`causal-runtime.json` には次が保存される。

```json
{
  "updatedAt": "...",
  "activeSources": ["ambient_brightness"],
  "proposals": [
    {
      "field": "mood",
      "score": 0.42,
      "delta": 2,
      "reason": "...",
      "topPathDescription": "環境光 → mood",
      "contributingSources": ["ambient_brightness"]
    }
  ],
  "feltSense": [
    {
      "target": "mood",
      "direction": "positive",
      "intensity": "medium",
      "text": "気分が少し持ち上がっていて、物事を前向きに見やすい。",
      "score": 0.42,
      "delta": 2
    }
  ]
}
```

---

## context / prompt への注入

因果は直接 system prompt に常駐するのではなく、heartbeat ごとに短い hint として注入される。

### 1. causal-hint

`causal-hint.ts` は `.claude/workingDirs/causal-runtime.json` を読み、
`feltSense` から最大3行の自然言語ヒントを作る。

例:

```text
気分が少し持ち上がっていて、物事を前向きに見やすい。
今は前向きな整理や軽い探索に向きやすい。
```

`autonomous-action.sh` はこれを `CAUSAL_HINT_SECTION` として prompt template の
`{CAUSAL_HINT}` に埋め込む。

### 2. recall-lite / causal-memory-bridge

`recall-lite.ts` は `causal-memory-bridge.ts` を呼び、現在 active な因果ノードと交差する memory を最大1件選ぶ。

流れ:

```text
causal-runtime.json
  -> activeNodes(mood/energy/health + direction)
  -> memory DB 直近160件
  -> affectedNodes / valence / confidence 推定
  -> 現在の activeNodes と重なる memory を scoring
  -> memory-hint として prompt に注入
```

出力例:

```text
[memory-hint — 因果接続。参考にせよ、ただし直接言及するな]
  - 最近の安心できる対話が、対人姿勢を少し開きやすくしている。
```

これも `autonomous-action.sh` の `{RECALL_LITE}` に入る。

### 3. prompt template

最終的な heartbeat prompt は概ね次の構造になる。

```text
自律行動（定期巡回）

@SOUL.md
@BOOT_SHUTDOWN.md
@TODO.md
@ROUTINES.md

{MORNING_SECTION}{ROUTINE_MODE}

{DESIRE_SECTION}
## 補足ルール
- {TIME_RULE}
- MCPが動作していなければ...
{INTEROCEPTION}
{RECALL_LITE}
{STATUS_HINT}
{CAUSAL_HINT}
```

したがって現行の prompt 注入経路は次の通りである。

```text
Lv1 causal-seeds
  -> Kuzu / SQLite
  -> causal-runtime proposals
  -> causal-runtime.json
  -> causal-hint
  -> {CAUSAL_HINT}

Lv1 causal-seeds + causal-runtime activeNodes + memory
  -> causal-memory-bridge
  -> memory-hint
  -> {RECALL_LITE}

Lv2 learned-seeds
  -> dashboard learnedGraph
  -> 現時点では prompt へ未注入
```

---

## Lv2をpromptへ効かせる将来フロー

Lv2 learned edge を prompt へ効かせるには、次の merge loader が必要になる。

```text
causal-seeds.json
  + learned-seeds.json(status=observing/confirmed)
  -> merged causal graph
  -> Kuzu / runtime
  -> proposals
  -> causal-runtime.json
  -> causal-hint / causal-memory-bridge
  -> prompt
```

merge 時の基本方針:

- nodes は `causal-seeds.json.nodes` を基準にする
- learned 側にしかない node は current metric または fallback label から補う
- edges は seed + learned を合成する
- seed と同じ `source -> target` がある learned edge は重複登録しない
- `status=observing` は低 weight のまま使い、`confirmed` はより強く扱う
- `direction=ambiguous` は runtime では使わず、dashboard / review 用に留める

この接続が入ると、たとえば次のような間接効果が prompt まで届く。

```text
ambient_brightness -> mood          (Lv1)
mood -> energy                      (Lv2 learned)
energy proposal -> causal-hint      (context injection)
```

つまり Lv2 は単独で「感情の絶対値を発火源」にするよりも、
まずは Lv1 の環境 source から downstream に辿れる補正として入れるのが安全である。

---

## dashboard 表示

Persona Dashboard では、`Causal Graph` セクションに2段で表示する。

1. **Lv1 causal-seed**
   - Kuzu / seed graph を表示
   - ノード選択、upstream / downstream trace、depth 切替あり

2. **Lv2 learned-seed**
   - `learned-seeds.json` を表示
   - 証拠数を edge 上の badge として表示
   - `source/target` がある edge は矢印
   - `direction=ambiguous` は点線
   - selection panel に関連 learned edge を表示

dashboard は Lv2 の観察・レビュー面であり、現時点では runtime の正本ではない。

---

## 全体フロー

### 現行フロー

```text
[Lv1]
causal-seeds.json
  -> syncPersonaStructuredStore()
  -> SQLite causal_edges
  -> syncKuzuCausalGraph()
  -> Kuzu
  -> environment-tick / causal-runtime
  -> STATUS.md + causal-runtime.json
  -> causal-hint / recall-lite
  -> autonomous prompt

[Lv2]
memory DB
  -> causal-edge-learner
  -> pending-learned-edges.json
  -> learned-seeds.json
  -> dashboard learnedGraph
```

### 目標フロー

```text
causal-seeds.json + learned-seeds.json
  -> merged graph
  -> Kuzu / runtime / dashboard
  -> STATUS.md + causal-runtime.json
  -> causal-hint + causal-memory-bridge
  -> context / prompt
```

---

## 実装上の注意

- `.env` や memory DB の実体はコミットしない
- Lv1 weight は設計値なので、軽い観測だけで変更しない
- Lv2 weight は「すぐ学び、すぐ弱まる」前提で低く始める
- Lv2 の `trust_mizuho` / `satiation` を絶対値 source として常時発火させない
- prompt へ入れる文は、因果グラフそのものではなく短い felt sense / action bias に圧縮する
- memory-hint は「参考にせよ、ただし直接言及するな」として注入し、露骨な説明文にしない
