# agent_design.md

## 2026-04-18 因果つき記憶注入の設計

## 一言でいうと

目指すのは、
**記憶をそのまま貼るエージェント**でも、
**センサー値をそのまま喋るエージェント**でもない。

目指すのは、
**現在の身体状態が因果グラフで解釈され、その結果として必要な記憶だけが短く会話ににじむエージェント**
である。

順番はこうする。

1. 観測がある
2. 因果グラフで「何がどう効いているか」を決める
3. その結果として内部状態と行動バイアスを作る
4. 必要な記憶だけを補助線として注入する

この順を守ることで、記憶の量に引っ張られず、
本能的な因果を中心に据えたまま振る舞いを作れる。

## 今回の前提

現状の実装では、次の事実がある。

- `environment-tick.ts` は環境観測から `mood` と `energy` を直接更新している
- `ambient_brightness` は未実装ではなく、
  `environment-tick.ts` が `.claude/scripts/capture-brightness-wifi.py` を呼び、
  wifi-cam の RTSP スナップショットから平均輝度を取っている
- `causal-kuzu.ts` / `causal-kuzu-node.mjs` は Kuzu graph の sync / snapshot / upstream / downstream trace を実装済み
- `interoception.ts` は現在状態を感覚テキストへ圧縮している
- `status-hint.ts` は行動ヒントを1行で生成している
- `autonomous-action.sh` には追加テキストを prompt に注入する仕組みが既にある

したがって、欠けているのは graph や prompt の器ではなく、
**graph を runtime に入れる接続層** である。

## 設計目標

今回の設計目標は4つある。

### 1. 状態更新に「原因」を持たせる

`mood = 67` ではなく、
`明るさが mood を押し上げ、熱負荷が energy を削っている`
という因果の形を持たせる。

### 2. LLM の推論コストを減らす

LLM に raw sensor や大量の記憶を渡して
「いい感じに理由を推測して」と任せない。

代わりに runtime 側で先に絞り込んで、
短い因果ヒントだけを prompt に入れる。

### 3. 記憶を因果に従属させる

記憶は主役ではなく補助線にする。

先に今の状態を決めるのは:

- Lv1 の本能的因果
- Lv2 の固定化因果
- Lv3 の現在文脈

であり、記憶はその説明や補強に使う。

### 4. context 上限を守る

graph の全体像や memory の候補群をそのまま prompt に入れない。
prompt に入るのは圧縮済みの短文だけにする。

## 非目標

今回は次のことはやらない。

- memory 全体の graph RAG 化
- Kuzu を唯一の正本にすること
- 学習因果の自動生成と自動採用
- prompt 内に graph のノード列や JSON を生で入れること

## アーキテクチャの考え方

今回の中核は、Kuzu を「答えを返す頭脳」としてではなく、
**因果のトポロジを保存し、runtime がそれを辿るための土台** として使うことにある。

実際の数値処理は TypeScript 側で行う。

理由は単純で、今の seed graph は次の情報を持っているからである。

- ノード
- エッジの向き
- causal level
- weight
- relation

しかし、まだ持っていない情報もある。

- relation の厳密な符号
- source node ごとの活性化規則
- target ごとの delta 変換規則
- prompt に載せる優先順位

したがって、初期実装では
**Kuzu は graph を返す**
**runtime は score を計算する**
という分業にするのが妥当である。

## 目標アーキテクチャ

```text
Sensor / Status / Memory
        |
        v
Observation Normalizer
        |
        v
Kuzu Graph Query
        |
        v
Causal Runtime
        |
        +--> STATUS update
        |
        +--> causal-runtime.json
        |
        +--> causal-hint.ts
                  |
                  v
               Prompt injection
```

## レイヤ構成

## Layer 0. Observation Layer

事実を置く層。
この時点では意味づけをしない。

初期入力:

- `ambient_brightness`
- `environment_thermal_load`
- `sleep_time`
- `blood_sugar`
- `body_temperature`
- `context_window_free`
- `recent_successful_interaction`

ただし、最初に runtime へ繋ぐのは次の2つだけでよい。

- `ambient_brightness`
- `environment_thermal_load`

### `ambient_brightness` の取得経路

この node の source は曖昧な仮置きではなく、現行実装がある。

- script: `.claude/scripts/capture-brightness-wifi.py`
- caller: `.claude/scripts/environment-tick.ts`
- method: wifi-cam の RTSP から1枚取得し、平均輝度を計算

したがって Phase 1 では、
新しいセンサー導入ではなく **既存の brightness 観測を graph runtime に繋ぐ** のが正しい。

ただし制約もある。

- TAPO 認証情報が必要
- RTSP と `ffmpeg` と PIL が必要
- 失敗時は brightness 系因果だけを無効化し、全体は継続する

## Layer 1. Activation Layer

観測値を、graph に流せる形へ正規化する層。

ここでは raw 値ではなく、**意味のある偏差** を作る。

例:

- `ambient_brightness`
  - `normalizedValue = 0..100`
  - `activation = (normalizedValue - 50) / 50`
  - 暗いと負、明るいと正
- `environment_thermal_load`
  - `normalizedValue = 0..100`
  - `activation = (normalizedValue - 50) / 50`
  - 涼しいと負、熱いと正

この「正負」を source 側で決めることで、
同じ propagation 式を多くの node に使えるようにする。

## Layer 2. Graph Topology Layer

Kuzu に保存される因果構造。

今ある機能で十分使えるもの:

- snapshot
- node 取得
- upstream trace
- downstream trace

特に runtime で必要なのは downstream trace で、
既に次が使える。

- `readKuzuCausalPathRows(startKey, "downstream", depth)`
- `readKuzuTraceBundle(startKey, "downstream" | "both", depth)`

つまり、query 機能の追加より先に runtime を作るべき段階にいる。

## Layer 3. Causal Runtime Layer

ここが今回の主役。

役割は3つある。

- active source から downstream path を取る
- score を計算して target state に集約する
- human-readable な理由を短く作る

### 最小の入力

- source node id
- activation
- raw / normalized observation
- observation reason

### 最小の出力

- target node id
- aggregated score
- proposed delta
- top contributing paths
- summary text

## Layer 4. Prompt Compression Layer

graph の情報をそのまま prompt に入れず、
会話に必要な最小表現へ圧縮する層。

ここで出すものは多くて3つ。

- 今の主因
- 現在の行動バイアス
- 必要なら関連記憶1件

ここで重要なのは、**報告文ではなく感覚文にすること** である。

- 悪い例:
  - 「熱負荷が energy を削っている」
- 良い例:
  - 「少し熱がこもる感じが続いていて、動きは鈍くなりやすい」

前者は外から来た説明として読まれやすい。
後者は自分の感覚として会話に混ざりやすい。

## 因果計算の最小仕様

Phase 1 では、単純で壊れにくい式を採用する。

### source activation

```text
activation = clamp((normalized - 50) / 50, -1.0, 1.0)
```

### relation sign

Phase 1 は relation から暫定的に符号を引く。

- `supports` / `lifts` / `raises` => `+1`
- `drains` / `pressures` / `lowers` => `-1`
- `proxies` => `0`
- `modulates` => source 側の意味に依存するので暫定扱い

`modulates` は本来 schema 拡張対象であり、
最初は source node が「逸脱の大きさ」を表すときだけ使う。

### path score

```text
pathScore =
  sourceActivation
  * Π(edgeWeight * edgeSign)
  * depthDecay^(pathLength - 1)
```

ここで `depthDecay` は 0.85 前後の小さな減衰係数を想定する。

### target aggregation

```text
targetScore = Σ(topK pathScore)
```

`topK` を使う理由は、長い path や弱い path を大量に足して
ノイズが膨らむのを防ぐためである。

### delta conversion

```text
delta = clamp(round(targetScore * scale[target]), minDelta[target], maxDelta[target])
```

初期の target ごとの scale 例:

- `mood`: 4
- `energy`: 6
- `health`: 4

## relation の限界と今後の拡張

今の seed edge は閲覧には十分だが、
runtime で長く使うには情報が少し足りない。

将来的には edge に次の属性を追加できる形にする。

- `effectSign`
  - `increase`
  - `decrease`
  - `proxy`
  - `contextual`
- `runtimeEnabled`
- `promptPriority`
- `confidence`

ただし、初手で schema を増やしすぎない。
まずは relation lookup で動くところまで持っていく。

## status 更新の考え方

大事なのは、graph を入れても `STATUS.md` を捨てないこと。

現状の役割分担は維持する。

- `STATUS.md`
  - 人間向けの現在状態
- `ENVIRONMENT.md`
  - 観測の可視化
- `persona-status.sqlite`
  - 構造化ストア
- `causal-runtime.json`
  - runtime 因果サマリ

つまり、
**graph は状態更新の根拠になり、STATUS は結果表示の窓口であり続ける**。

## 新規に置く runtime 状態

新規ファイル案:

- `.claude/workingDirs/causal-runtime.json`

想定 schema:

```json
{
  "updatedAt": "2026-04-18T12:00:00.000Z",
  "sources": [
    {
      "id": "ambient_brightness",
      "activation": 0.62,
      "normalizedValue": 81,
      "reason": "環境光 81/100"
    }
  ],
  "targets": [
    {
      "id": "mood",
      "score": 0.47,
      "delta": 2,
      "summary": "明るさが mood を持ち上げている",
      "topPaths": [
        {
          "sourceId": "ambient_brightness",
          "terminalId": "mood",
          "score": 0.47
        }
      ]
    }
  ],
  "debug": {
    "topCause": "environment_thermal_load -> energy",
    "topScore": -0.51
  },
  "prompt": {
    "renderMode": "template-v1",
    "feltSense": "明るさに押されて、気分が少し軽い。",
    "actionBias": "今は前向きな整理や軽い探索に向きやすい。",
    "tone": "internal"
  }
}
```

このファイルは prompt 生成と debug の両方に使える。

ここで分けるべきなのは:

- `debug`
  - 因果経路を確認するための説明
- `prompt`
  - 会話に混ざる感覚文

同じ文を両方に使わない。

## prompt 生成ポリシー

`causal-runtime.json` の `prompt` フィールドは、
初期実装では **LLM で生成しない**。

生成責務は `causal-runtime.ts` に置き、
template-based に決める。

理由:

- 毎回のコストを増やさない
- 文体が安定する
- 「感覚文」と「報告文」を意図的に分離できる
- 因果の強さに応じて言い回しを制御しやすい

### template 生成の最小ルール

- target
  - `mood`
  - `energy`
  - `health`
- direction
  - positive
  - negative
- intensity
  - low
  - mid
  - high

この組み合わせごとに、候補文を持つ。
最初の実装では、これを **18 個の基本スロット** として扱う。

- `3 targets x 2 directions x 3 intensities = 18`

重要なのは、ここを曖昧な「適当に言い換える」領域にしないことだ。
`causal-hint.ts` の自然さは、このテンプレート粒度に強く依存する。

初期実装の方針:

- 各スロットにまず 1 文ずつ置く
- ランダム性や言い換えは後回しにする
- まずは「違和感のない感覚文が安定して出る」ことを優先する

例:

- `mood / positive / strong`
  - 「気持ちが軽い。よく動ける感じがある。」
- `mood / positive / low`
  - 「周りの明るさに押されて、気分が少し軽い。」
- `energy / negative / low`
  - 「少し重みがある。普段より動きが鈍い。」
- `energy / negative / mid`
  - 「熱がこもる感じが続いていて、動きは鈍くなりやすい。」
- `health / negative / mid`
  - 「少し消耗がたまっていて、無理はしないほうがよさそう。」

将来的に LLM で言い換える余地はあるが、
それは offline tuning か任意オプションに留める。

### テンプレート設計の原則

テンプレートを書くときは次を守る。

1. ノード名を言わない
2. relation 名を言わない
3. 原因説明より先に感覚を書く
4. 1 文を短くしすぎず、報告調にも寄せすぎない
5. `interoception` と競合せず、因果の「向き」をにじませる

悪い例:

- 「environment_thermal_load の影響で energy が低下している」

良い例:

- 「熱がこもる感じが続いていて、普段より動きが鈍い」

ここで必要なのは厳密な説明ではなく、
**自分の内側にある感じとして読めること** である。

## 会話注入の設計

### interoception との役割分担

- `interoception.ts`
  - 感覚の質感を出す
  - 主観的な身体感覚
- `status-hint.ts`
  - 行動カテゴリの簡易ヒント
- `causal-hint.ts`
  - 「なぜ今そうなのか」を短く出す

この3つは似ているが役割が違う。

例:

- interoception:
  - 「少し疲れがある。何かを欲している。」
- status-hint:
  - 「重いタスクは避ける。」
- causal-hint:
  - 「少し熱がこもる感じが続いていて、今は軽いものから触れたい。」

### prompt に入れる量

上限を明示する。

- 最大3行
- できれば 200〜350 文字以内
- 記憶補助を入れても 1 件だけ

### prompt に入れないもの

- raw observation 一覧
- graph 全ノード
- path の ID 群
- JSON
- 複数 memory 候補
- `energy` や `relation` 名をそのまま含む報告文

## memory との接続設計

今回の最終目標は「因果つき記憶注入」だが、
memory を graph の中心に置かない。

接続の仕方は次の順にする。

### Step 1. current cause を先に決める

先に active target を決める。

例:

- `energy` が低下
- 理由は `environment_thermal_load`

この段階では memory をまだ見ない。

### Step 2. 必要なときだけ supporting memory を探す

次に、active target と交差する記憶があるかを見る。

例:

- `trust_mizuho`
- `mood`
- `social_openness`

のように対話寄りの node が active なら、
recent successful interaction 系の記憶を探す価値がある。

### Step 3. 記憶は補強として1件だけ出す

たとえば:

- 「最近の安心できる対話の記憶が、対人姿勢を少し開きやすくしている。」

この1行だけで十分である。

### memory metadata の候補

後で必要になる metadata の候補は次の通り。

- `affected_nodes`
- `entity`
- `valence`
- `confidence`
- `recency_weight`
- `narrative_role`

ただし、これは Phase 4 以降でよい。

## 因果の優先順位

この設計で一番守りたいのは優先順位である。

会話時の判断順は次のようにする。

1. Lv1 因果で身体の基本傾向を決める
2. Lv2 因果で個体差を補正する
3. Lv3 因果で今の文脈を乗せる
4. 記憶で説明を補強する
5. その残りを LLM が自然に埋める

この順番なら、
記憶が多くても「その時々の本能的な感じ」が壊れにくい。

## failure mode と fallback

### 1. Kuzu が読めない

fallback:

- `environment-tick.ts` は現在の直書きルールへ戻る
- prompt には causal hint を出さない

### 1.5 brightness が取れない

fallback:

- wifi-cam 由来の `ambient_brightness` を inactive にする
- thermal 系など他の因果だけで継続する
- prompt には brightness 起因の感覚文を出さない

### 2. path が多すぎて説明が散る

fallback:

- top path のみ採用
- target ごとに1説明だけ出す

### 3. memory が強すぎて本体を上書きする

fallback:

- memory hint は cause hint の後ろにしか出さない
- memory だけで delta を変えない

### 4. context が厳しい

fallback:

- `causal-hint.ts` は 1 行だけに縮退する
- memory bridge を止める

### 5. causal-hint が外部レポートのように見える

fallback:

- `debug` と `prompt` を分離保存する
- `causal-hint.ts` は `prompt` だけ読む
- graph 用語を出したらテストで落とす

## 実装順の提案

この設計から導かれる実装順は明確である。

1. `causal-runtime.ts` を追加する
2. `environment-tick.ts` に入れる
3. `causal-runtime.json` を保存する
4. `causal-hint.ts` を追加する
5. `autonomous-action.sh` と `prompts.toml` に差し込む
6. その後に memory bridge を足す

## この設計の核

この設計の核は、
**Kuzu を「飾りの graph」から「身体と記憶の間にある因果層」へ変えること**
である。

重要なのは、LLM に全部考えさせないことだ。

- 何が効いているか
- その結果どう振る舞いやすいか
- 記憶が関係あるならどれか

ここまでを runtime で絞ってから prompt に渡す。

そうすれば、

- context を節約できる
- 推論を節約できる
- それでも個体固有の因果を守れる

この方向で進める。
