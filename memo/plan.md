# 因果注入の実装計画

## 目的

この計画の目的は、記憶をただ想起するのではなく、
**現在の身体状態と固有の因果を経由して会話ににじませること**である。

やりたいことは次の3つに分かれる。

- 現在状態に「なぜそうなっているか」を与える
- その因果を短い形で会話プロンプトへ注入する
- 記憶も「関連があるから出る」状態にし、文脈肥大を防ぐ

このために、まずは **Kuzu graph を runtime に入れる**。
最初から memory 全体を graph 化しない。

## 現状認識

現在のコードは次の形になっている。

- `.claude/scripts/environment-tick.ts`
  - 環境センサーから `energy` と `mood` を直接更新している
  - 明るさと熱負荷のルールはコードに直書きされている
  - `ambient_brightness` は未定義ではなく、現状でも
    `.claude/scripts/capture-brightness-wifi.py` を通じて
    wifi-cam の RTSP から取得している
- `.claude/scripts/causal-kuzu.ts`
  - Kuzu への同期、snapshot、node 取得、path trace が実装済み
  - `readKuzuCausalPathRows(startKey, "downstream", depth)` と
    `readKuzuTraceBundle(startKey, "downstream" | "both", depth)` が既に使える
- `.claude/scripts/interoception.ts`
  - `STATUS.md` を読んで、身体感覚の自然言語を生成している
- `.claude/scripts/status-hint.ts`
  - 行動ヒントを自然言語で1行生成している
- `autonomous-action.sh`
  - `INTEROCEPTION` と `STATUS_HINT` と `RECALL_LITE` をプロンプトに注入している

つまり、

- graph はある
- trace もできる
- prompt 注入経路もある

が、

- graph を使って状態更新していない
- graph を使って会話注入していない
- 記憶と因果が接続されていない

という状態で止まっている。

## 基本方針

今回の実装は次の原則で進める。

### 1. Kuzu は「構造の保存先」であり、「数値計算本体」ではない

Kuzu には因果ノードとエッジを保存し、runtime は TypeScript 側で行う。

理由:

- 既存 seed は graph 構造として十分使える
- ただし今の edge schema だけでは数値伝播の規則までは表現していない
- まずは query で path を取り、TS 側で軽量に計算したほうが導入が早い

### 2. 最初は environment -> status の接続だけを入れる

初手で memory 全体を graph に繋がない。
まずは既に動いている観測値を graph 経由で status へ反映する。

最初の対象:

- `ambient_brightness -> mood`
- `environment_thermal_load -> energy`
- `environment_thermal_load -> health`

### 3. prompt に入れるのは graph そのものではなく「圧縮した因果ヒント」

LLM に大量の graph 情報を見せない。
prompt に入れるのは最大でも次の3要素だけにする。

- 今の主因
- その結果の行動バイアス
- 必要なときだけ関連記憶1件

### 4. 本能的因果を最上位に置く

優先順位は次の順にする。

1. Lv1 の因果
2. Lv2 の固定化された因果
3. Lv3 の文脈因果
4. 記憶由来の補助的因果
5. LLM の自由推論

これにより、記憶が増えても「基本の身体因果」が崩れないようにする。

### 5. debug 用の文体と prompt 用の文体を分ける

同じ因果でも、使う場所で文体を変える。

- log / debug / inspect
  - 因果経路を明示する説明文でよい
  - 例: `environment_thermal_load -> energy`
- prompt 注入
  - 主観的な感覚文にする
  - 例: 「少し熱がこもる感じが続いていて、動きは鈍くなりやすい」

`causal-hint.ts` は後者だけを出す。
報告文をそのまま prompt に入れない。

## 何を最初の完成とみなすか

最初の完成は、次の状態である。

- `environment-tick.ts` が Kuzu の下流 trace を使って `mood` / `energy` / `health` を更新する
- 更新理由が「直値ルール」ではなく「因果経路」に基づく説明になる
- その結果を短くまとめる `causal-hint.ts` が追加される
- `autonomous-action.sh` が `CAUSAL_HINT` を prompt に注入する
- prompt 増分は小さいままで、graph 全体は入らない

この段階では、まだ memory 因果統合は始めなくてよい。

## 実装フェーズ

## Phase 1: Kuzu を environment-tick に入れる

### 目的

graph を「閲覧用」から「状態更新用」へ変える。

### やること

- 新規: `.claude/scripts/causal-runtime.ts`
  - source node の活性値を作る
  - Kuzu から downstream path を取得する
  - path ごとの影響スコアを計算する
  - `mood` / `energy` / `health` への提案 delta を返す
- 変更: `.claude/scripts/environment-tick.ts`
  - brightness と thermal load の観測後に `causal-runtime.ts` を呼ぶ
  - 現行の直書きルールを graph 計算へ置き換える
  - 失敗時のみ既存ルールに fallback する

### 活性値の最小仕様

- `ambient_brightness`
  - `normalizedValue` を 0-100 から -1.0 〜 +1.0 に変換する
  - 暗いと負、明るいと正
- `environment_thermal_load`
  - `normalizedValue` を 0-100 から -1.0 〜 +1.0 に変換する
  - 涼しいと負、熱いと正

### `ambient_brightness` の現行データソース

ここは未決ではなく、現状の取得経路を前提に進める。

- 実装: `.claude/scripts/capture-brightness-wifi.py`
- 呼び出し元: `.claude/scripts/environment-tick.ts`
- 実体: wifi-cam の RTSP スナップショットから平均輝度を計算
- 実行タイミング: `autonomous-action.sh` からの定期 `environment-tick`

注意点:

- TAPO 認証情報と RTSP が使えないと取得できない
- 取得失敗時は brightness 系の因果だけをスキップし、全体は止めない

### 最初の伝播対象

- `ambient_brightness -> mood`
- `environment_thermal_load -> energy`
- `environment_thermal_load -> health`

### 完了条件

- 環境観測後の log に top cause path が出る
- `STATUS.md` の理由欄が path ベースになる
- `make persona-causal-trace KEY=ambient_brightness DIRECTION=downstream DEPTH=2` の結果と runtime 挙動が一致する

## Phase 2: 因果ランタイム状態を保存する

### 目的

状態更新と prompt 注入の間に、再利用できる「因果サマリ」を置く。

### やること

- 新規: `.claude/workingDirs/causal-runtime.json`
- 保存する内容:
  - `updatedAt`
  - active source nodes
  - target ごとの score と delta
  - 採用した top path
  - debug 用の因果説明
  - prompt 用の感覚文スロット

### ここで得られるもの

- prompt 用の情報を毎回再計算しなくてよくなる
- dashboard や debug に流用できる
- memory 因果統合の入力地点になる

### `causal-runtime.json` の生成方式

ここは hot path で LLM を使わない。

- `debug`
  - path と score をそのまま保存する
- `prompt`
  - `causal-runtime.ts` がテンプレートで生成する
  - target / direction / intensity ごとの定型表現を使う

理由:

- 毎回のコストを増やさない
- 文体を安定させられる
- 感覚文と報告文を意図的に分離できる

将来、LLM による言い換えを試す余地はあるが、
初期実装の標準経路には入れない。

### テンプレートの粒度

テンプレートの粒度は実装の肝なので、Phase 2 の時点で最小単位を固定する。

最初の実装では、`feltSense` を次の軸で持つ。

- target
  - `mood`
  - `energy`
  - `health`
- direction
  - `positive`
  - `negative`
- intensity
  - `weak`
  - `medium`
  - `strong`

つまり、最低でも `3 x 2 x 3 = 18` スロットを持つ。

初期実装では各スロット1文でよい。
表現の多様化はその後で行う。

例:

- `mood x positive x strong`
  - 「気持ちが軽い。よく動ける感じがある。」
- `energy x negative x weak`
  - 「少し重みがある。普段より動きが鈍い。」
- `health x negative x medium`
  - 「少し消耗がたまっていて、無理はしないほうがよさそう。」

`actionBias` は初期段階では別軸で細かく増やしすぎず、
まずは target ごとに1つの補助文を持つ程度で始める。

## Phase 3: 会話用の causal hint を追加する

### 目的

現在の内部状態に「なぜ今そうなのか」を短く持たせる。

### やること

- 新規: `.claude/scripts/causal-hint.ts`
  - `causal-runtime.json` を読む
  - 上位1〜2件の因果だけを自然言語で出す
- 変更: `autonomous-action.sh`
  - `CAUSAL_HINT_TEXT` を生成する
  - prompt テンプレートに `{CAUSAL_HINT}` を追加する
- 変更: `prompts.toml`
  - `INTEROCEPTION` / `RECALL_LITE` / `STATUS_HINT` の並びに `CAUSAL_HINT` を追加する

### 出力方針

出すのは最大3行まで。

- 1行目: 今の主因
- 2行目: 行動バイアス
- 3行目: 必要なときだけ補足

文体ルール:

- 因果のラベル名をそのまま出さない
- 「X が Y を削っている」のような報告文を避ける
- 「少し重い感じがある」「今は軽いものから触れたい」のような
  感覚寄りの言い方を使う

### 完了条件

- prompt 増分が小さい
- raw graph や JSON が prompt に入らない
- `INTEROCEPTION` と役割が衝突しない
- 感覚文として読め、外部レポートのように見えない

## Phase 4: 記憶を因果ノードへ橋渡しする

### 目的

記憶を「ただ似ているから出る」のではなく、
**今アクティブな因果を説明するために出す** ようにする。

### やること

- `recall-lite` を置き換えるのではなく、因果側から薄く接続する
- 新規 metadata の候補:
  - `affected_nodes`
  - `valence`
  - `confidence`
  - `entity`
  - `time_bias`
- 新規: `.claude/scripts/causal-memory-bridge.ts` もしくは
  `recall-lite.ts` の拡張

### 最初の運用ルール

- 1回の prompt に入れる記憶は最大1件
- active target node と交差しない記憶は出さない
- Lv1 因果を上書きしない

### 例

- `trust_mizuho` が active
- 直近の成功会話 memory がある
- そのときだけ
  - 「最近の安心できる対話が、対人姿勢を少し開きやすくしている」
  のように短く注入する

## Phase 5: 学習因果を別トラックで追加する

### 目的

seed 因果とは別に、経験から見えた Lv3 因果候補を蓄積する。

### やること

- 自動採用しない
- まずは候補として保存する
- review してから seed または learned edge に昇格する

### 理由

今は「固有の因果を守る」ことが主目的なので、
learned edge は seed を乱さない形で後から入れる。

## 直近の実装順

今すぐ着手する順序は次の通り。

1. `.claude/scripts/causal-runtime.ts` を作る
2. `environment-tick.ts` からそれを呼ぶ
3. `causal-runtime.json` を保存する
4. `causal-hint.ts` を作る
5. `autonomous-action.sh` と `prompts.toml` に `CAUSAL_HINT` を追加する
6. その後に memory bridge を設計する

## 具体的なファイル単位の作業

### 新規追加

- `.claude/scripts/causal-runtime.ts`
- `.claude/scripts/causal-runtime.test.ts`
- `.claude/scripts/causal-hint.ts`

### 修正

- `.claude/scripts/environment-tick.ts`
- `autonomous-action.sh`
- `prompts.toml`

### 余裕があれば

- `.claude/scripts/persona-data.ts`
  - 因果ランタイム状態を sqlite に取り込む
- `docs/guides/make-commands.md`
  - runtime / hint の確認コマンドを追記する

## テスト方針

最低限必要なテストは次の通り。

- brightness が高いと `mood` 提案 delta が正になる
- brightness が低いと `mood` 提案 delta が負になる
- thermal load が高いと `energy` と `health` が負方向になる
- thermal load が低いと回復方向に寄る
- Kuzu が読めないとき fallback が動く
- `causal-hint.ts` の文字数と行数が上限内に収まる
- `causal-hint.ts` がノード名や relation 名を露出しない
- wifi-cam 輝度取得失敗時に brightness 系だけが穏当にスキップされる
- 18 個の基本テンプレートスロットが欠けずに定義されている

## リスクと対策

### 1. edge の意味が数値計算に十分でない

今の seed は `relation` が語彙ベースなので、厳密な計算仕様には足りない。

対策:

- Phase 1 は relation の lookup table で始める
- その後、必要なら edge に `effectSign` や `effectMode` を追加する

### 2. prompt が肥大する

対策:

- causal hint は最大3行
- memory bridge は最大1件
- graph の詳細は file / log に逃がし、prompt には入れない

### 3. Kuzu 障害で定期巡回が止まる

対策:

- read failure 時は現行の直書きルールへ fallback
- Kuzu は「使えれば使う」扱いで導入する

### 4. 感覚文ではなく報告文になってしまう

対策:

- `causal-runtime.json` に debug と prompt を分けて保存する
- `causal-hint.ts` は template-based の感覚文のみ出す
- graph 用語は log 側に閉じ込める

## この計画の核心

今回の核心は、
**Kuzu を保存しただけで終わらせず、status 更新と会話注入の間に実際に流すこと**
である。

最小の一手は明確である。

- `environment-tick.ts` に Kuzu を噛ませる
- 因果サマリを保存する
- それを短く会話へ入れる

まずはここまでを第一目標にする。
