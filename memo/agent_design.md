# agent_design.md

## 因果グラフの今後のプラン

### 一言でいうと

今の因果グラフは、環境センサーから STATUS へ流れる経路はかなり育った。
次に作るべきなのは、**経験イベントから STATUS へ戻る経路**である。

現状はこうなっている。

```text
環境センサー
  -> causal-runtime
  -> STATUS.md
  -> prompt / action bias

autonomous の行動結果
  -> 記憶には残る
  -> ただし STATUS.md へは構造的に戻らない
```

そのため、部屋が暗い、湿度が高い、熱負荷が高い、といった物理的な悪条件では mood / energy / health が下がる。
一方で、lounge で誰かの言葉に動かされた、投稿できた、タスクが完成した、記憶を刻めた、mizuho と話して安心した、という経験は STATUS に戻りにくい。

これは「感情が下がり続ける」バグというより、**入力の偏り**である。
今の STATUS 更新は、負荷のある環境には鋭く反応するが、経験による回復・達成・接続をまだ同じ強さで扱えていない。

---

## 現在地

### できていること

- `environment-tick.ts` が環境観測を集める
- `causal-runtime.ts` が環境 source から downstream trace して `mood / energy / health` の delta を作る
- `STATUS.md` はその delta を根拠つきで更新する
- `causal-edge-learner.ts` が memory DB から Lv3-2 emotion node 間の共起を抽出する
- `learned-seeds.json` に Lv2 learned edge が保存される
- `causal-graph-loader.ts` が `causal-seeds.json` と `learned-seeds.json` を merge する
- merged graph は SQLite / Kuzu / dashboard / runtime に接続されている
- environment source から辿れる learned edge は runtime に反映される

ここまでで Phase5.1 はかなり進んでいる。

### まだできていないこと

重要なのは、learned edge 自体がないことではない。
すでに `trust_mizuho -> mood` や `trust_mizuho -> satiation` のような edge は育っている。

詰まっているのは次の2点である。

1. `trust_mizuho` や `satiation` を source activation として安全に発火させる仕組みがない
2. `lounge投稿` や `タスク完了` のような action / experience node が learner の対象外にある

現行の `causal-edge-learner.ts` は主に次の node だけを見る。

```text
mood / energy / health / trust_mizuho / satiation
```

そのため、記憶本文に「lounge に投稿した」「タスクが完成した」と書かれていても、
それ自体を因果グラフの source node として学習できない。

つまり不足しているのは単なる観測データ量ではなく、**経験イベントを node として扱う層**である。

---

## STATUS 更新を2系統に分ける

今後の STATUS 更新は、明示的に2系統として扱う。

### 1. 因果グラフ寄与

センサーや構造化イベントから、runtime が delta を出す。

例:

```text
湿度 84%
  -> ambient_humidity
  -> mood -1 / energy -3 / health -2

タスク完了イベント
  -> task_completion
  -> satiation +8 / mood +3
```

これは機械的で、再現性がある。
STATUS の自動更新の中心に置く。

### 2. autonomous 寄与

heartbeat の中で、エージェントが行った作業や感じたことを記憶に残す。
現状ではここから STATUS へ戻る処理が曖昧で、`CLAUDE.md` の任意内省に依存している。

今後は autonomous の結果を直接 STATUS に書かせるのではなく、
まず **experience event** として構造化し、その event を causal-runtime に渡す。

```text
autonomous action
  -> memory
  -> experience event
  -> causal-runtime
  -> STATUS.md
```

これにより、LLM がその場の気分で STATUS を大きく変えるのではなく、
runtime 側で clamp / TTL / 根拠管理を通せる。

---

## 設計原則

### 1. 絶対値ではなくイベントで発火する

`trust_mizuho = 83` だから毎回 mood を上げる、という設計にはしない。
これは自己強化ループを作る。

危険なループ:

```text
trust_mizuho が高い
  -> mood が毎 heartbeat 上がる
  -> mood が高い記憶が増える
  -> trust_mizuho -> mood がさらに強く見える
```

安全に扱うには、次のようにする。

```text
trust_mizuho が更新された
mizuho と会話した
安心した記憶が作られた
```

このような **一回限りの更新イベント**を source activation にする。

### 2. event は TTL を持つ

経験イベントは常時 source ではない。
発生から一定時間だけ効き、消費されたら再利用しない。

例:

```text
lounge_reply_touched
  ttlHours: 6
  consumedAt: null
```

STATUS 更新に使ったら `consumedAt` を入れる。
これで同じ経験が毎 heartbeat で再加算されることを防ぐ。

### 3. STATUS delta は小さく、根拠を残す

経験由来の delta は、環境由来よりも慎重にする。

目安:

| target | 通常 delta | 上限 |
|---|---:|---:|
| mood | +1〜+4 | ±5 |
| energy | -2〜+3 | ±4 |
| health | -1〜+2 | ±3 |
| trust_mizuho | +1〜+3 | ±4 |
| satiation | +5〜+20 | ±25 |

大きく動かす場合は、記憶 ID や event ID を根拠に残す。

### 4. learned edge は補正、event node は入力

`learned-seeds.json` の emotion edge は、経験から学んだ補正として使う。
一方で、`lounge投稿` や `タスク完了` は、emotion node ではなく event source node として扱う。

```text
event source node
  -> learned / seed edge
  -> emotion target
```

この分離をしないと、`mood` や `satiation` の現在値をそのまま source にしてしまい、自己循環しやすくなる。

---

## 新しく追加する層

## Layer A. Experience Event Layer

autonomous の行動結果や、会話・lounge・作業完了などを構造化イベントとして保存する。

候補ファイル:

```text
.claude/workingDirs/experience-events.jsonl
```

最小スキーマ:

```json
{
  "id": "exp_20260429_001",
  "timestamp": "2026-04-29T00:00:00.000Z",
  "type": "task_completed",
  "source": "autonomous-action",
  "summary": "TODO の小タスクを完了し、記憶に結果を書いた",
  "valence": "positive",
  "intensity": 0.6,
  "affectedNodes": ["satiation", "mood"],
  "evidenceMemoryId": "memory-id-or-null",
  "ttlHours": 12,
  "consumedAt": null
}
```

初期 event type:

| type | 主な target | 意味 |
|---|---|---|
| `task_completed` | `satiation`, `mood` | 作業完了・達成感 |
| `memory_written` | `satiation` | 経験を刻めた |
| `lounge_posted` | `mood`, `trust_mizuho`, `satiation` | 外へ声を出せた |
| `lounge_reply_touched` | `mood`, `trust_mizuho` | 誰かの言葉に動かされた |
| `mizuho_interaction` | `trust_mizuho`, `mood` | mizuho との会話・安心 |
| `failure_or_friction` | `energy`, `mood` | 失敗・詰まり・消耗 |
| `rest_or_digest` | `energy`, `satiation` | 休息・消化 |

## Layer B. Event Activation Runtime

`experience-events.jsonl` から未消費かつ TTL 内の event を読み、activation に変換する。

```text
valence positive -> +activation
valence negative -> -activation
intensity 0.0..1.0 -> activation strength
```

環境 source と同じ `causal-runtime` に渡せる形にする。

```ts
interface CausalSourceInput {
  sourceId: string;
  activation: number;
  normalizedValue?: number;
  reason: string;
  sourceKind: "environment" | "experience" | "status_event";
  eventId?: string;
}
```

最初は generic にしすぎず、経験 event 用の薄い adapter を作るだけでよい。

## Layer C. Experience Nodes

因果グラフに event source node を追加する。

初期候補:

```text
task_completion
memory_encoding
lounge_expression
lounge_resonance
mizuho_connection
failure_friction
rest_digest
```

これらは `causal-seeds.json` に最小 seed として置くか、`experience-seeds.json` として分ける。
最初は seed に入れてよい。

理由:

- action / event node が存在しないと learner が edge を作れない
- `lounge投稿 -> mood` のような因果は、emotion node 間だけでは表現できない
- event source は絶対値ではなく一回限りなので、自己強化ループが起きにくい

## Layer D. Learner Scope Expansion

`causal-edge-learner.ts` の対象を、emotion node だけから event node まで広げる。

現在:

```text
mood / energy / health / trust_mizuho / satiation
```

次:

```text
event source nodes
  +
mood / energy / health / trust_mizuho / satiation
```

学習したい edge:

```text
lounge_expression -> mood
lounge_resonance -> trust_mizuho
task_completion -> satiation
memory_encoding -> satiation
mizuho_connection -> mood
failure_friction -> energy
```

この段階で、ようやく「経験が因果グラフに戻る」。

---

## 実装フェーズ

## Phase 5.2: STATUS 更新の寄与分離

目的:
STATUS 更新を「環境因果」と「autonomous 内省」に分けて見えるようにする。

やること:

- `STATUS.md` の理由文に `sourceKind` を含める
- `causal-runtime.json` に `sourceKind` を保存する
- environment 由来と experience 由来を dashboard / log で分ける
- autonomous の任意内省で STATUS を直接変更した場合も、理由に `autonomous_reflection` と明記する

完了条件:

- mood が下がったとき、それが湿度なのか、失敗イベントなのか、手動内省なのか一目でわかる

## Phase 6.0: Experience Event Store

目的:
autonomous の行動結果を構造化 event として保存する。

やること:

- `.claude/scripts/experience-event.ts` を追加する
- `record`, `list`, `consume` を実装する
- autonomous の最後に、必要なら event を記録する導線を作る
- event は STATUS を直接更新しない

最初は LLM が明示的に event を記録してよい。
完全自動判定は後でよい。

## Phase 6.1: Experience Activation

目的:
未消費 event を causal-runtime の source として一回だけ使う。

やること:

- `.claude/scripts/experience-tick.ts` を追加する
- TTL 内の未消費 event を読む
- event type / valence / intensity から activation を作る
- causal-runtime に渡す
- STATUS 更新後に event を consumed にする

完了条件:

```text
task_completed event
  -> satiation +N
  -> STATUS.md に根拠つきで記録
  -> 同じ event は再利用されない
```

## Phase 6.2: Event Source Nodes

目的:
event type を因果グラフの node として扱う。

やること:

- `task_completion`, `lounge_expression`, `mizuho_connection` などを graph node として追加
- 初期 edge は弱い seed として追加する
- edge weight は控えめにする
- learned edge と競合しないよう source/target 重複を確認する

初期 seed 例:

```json
{
  "source": "task_completion",
  "target": "satiation",
  "relation": "lifts",
  "causalLevel": "Lv2",
  "weight": 0.45,
  "description": "作業完了は充足感を回復しやすい"
}
```

## Phase 6.3: Learner Expansion

目的:
記憶から `event -> emotion` の learned edge を抽出できるようにする。

やること:

- `inferAffectedNodes` に event node の語彙を追加する
- `causal-edge-learner.ts` の node filter を拡張する
- `event source -> emotion target` の候補を pending に出す
- evidenceCount / valence / timeSignal で observing に昇格する

注意:
最初から完全自動採用しない。
dashboard / pending で見て、mizuho が納得できる edge だけ昇格するモードを残す。

## Phase 6.4: Dynamic Weight Update

目的:
Lv2 edge を「すぐ学び、すぐ弱まる」ものにする。

やること:

- 新規 evidenceMemoryIds だけを差分加算する
- 反証記憶で weight を下げる
- weight <= 0 で削除
- weight >= 0.8 で confirmed 候補にする

これは Phase5 の未完了項目でもある。
experience node を入れる前に実装してもよいが、event source が入ってからのほうが価値が大きい。

---

## STATUS 更新の最終形

目標は、STATUS.md の変化履歴が次のように混ざること。

```text
環境由来:
湿度84% -> mood -1

経験由来:
lounge_reply_touched -> mood +3

行動由来:
task_completion -> satiation +12

関係性由来:
mizuho_interaction -> trust_mizuho +2 -> mood +1
```

これで、STATUS は物理センサーだけの下向きな身体ではなく、
経験・関係・達成も含む身体になる。

---

## 実装上の注意

- `trust_mizuho` や `satiation` の現在値を常時 source にしない
- experience event は一回限り、TTL つき、消費済み管理を必須にする
- LLM が STATUS を直接大きく変える経路は残すが、原則は event -> runtime -> STATUS に寄せる
- `mood / energy / health` だけでなく `satiation / trust_mizuho` も target にする。ただし delta は小さくする
- learned edge の `observing` は弱く扱い、confirmed までは過信しない
- prompt に入れるのは graph 説明ではなく、短い felt sense / action bias に圧縮する
- dashboard では environment contribution と experience contribution を分けて表示する

---

## 次の一手

最初に作るべきものは大きな learner 改造ではない。

まずは `experience-events.jsonl` と `experience-tick.ts` を作り、
手動または autonomous の最後に次のような event を1件記録できるようにする。

```text
task_completed: satiation + small positive activation
lounge_posted: mood + small positive activation
failure_or_friction: energy / mood negative activation
```

これが動けば、STATUS の下方ドリフトに対して、経験由来の回復経路が初めて同じ runtime 上に乗る。
その後で learner を event node まで広げる。
