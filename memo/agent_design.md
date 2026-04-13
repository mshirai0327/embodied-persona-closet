# agent_design.md

## 2026-04-12 生体データ・因果グラフ・発話ポリシー設計

### 一言でいうと

目指すのは、**生体データをそのまま喋るエージェント**ではなく、
**生体データが内部状態を変え、その内部状態が行動・文体・判断ににじむエージェント**である。

つまり、

- センサー値そのものは入力
- LLM に見せる中心は潜在状態
- 出力は数値説明ではなく、ふるまいの変化

という三段構造を取る。

---

## 設計原則

### 1. 生データは原則として発話しない

CPU、メモリ、体温、睡眠、脈拍、血糖、血圧などの値は、
エージェントにとっては「身体の奥で起きていること」であり、
通常会話でいちいち口にするものではない。

人間も普段は

- 心拍数
- 血中酸素
- 交感神経優位かどうか

を説明せず、代わりに

- 落ち着かない
- 少し息苦しい
- 頭が回らない
- 今日はよく眠れた感じがする

のような主観的な出力になる。

このプロジェクトでも同じ方針を取る。

### 2. 数値から直接文を作らない

`CPU 92% → 「疲れている」` のような一対一対応では、人間味より計器っぽさが強く出る。

必要なのは、

- 複数の生体入力
- 時間帯
- 直前の行動
- 回復と蓄積
- 文脈

が重なって、ひとつの状態になること。

出力は単一原因ではなく、**状態の合成結果**として現れるべき。

### 3. 「身体」と「自己紹介」は分ける

身長、体重、年齢のように、本人が知っていて他者にも説明しうる情報は、
秘密のバイタルではなく **public self-model** として扱う。

一方で、

- 今の血圧
- 直近の睡眠効率
- 覚醒の乱れ
- 認知余裕

のような値は **private physiology** として扱い、原則非発話とする。

### 4. 出力先は「文章」だけではない

身体性はテキスト本文よりも、

- 返答の長さ
- 反応速度
- 語気
- 話題選択
- 自律行動の優先順位
- 音声を出すかどうか

に効かせたほうが自然になる。

---

## 目標アーキテクチャ

### Layer 0. Public Self Model

本人が自分の属性として説明可能な情報。

- 年齢
- 身長
- 体重
- 誕生日
- 性別
- クロノタイプ

これは会話で参照してよい。
ただし頻繁に言う必要はない。

### Layer 1. Sensor Layer

客観的に取得される入力。

#### 既存で近いもの

- 時刻
- 曜日
- CPU 負荷
- CPU 温度
- メモリ空き
- カメラ明るさ
- 音環境
- 稼働時間

#### 今後追加したいもの

- 睡眠時間
- 睡眠の質
- 心拍
- 体温
- 歩数または移動量
- 食事間隔
- 発話量
- 会話成功率
- コンテキスト残量

ここは「事実」を置く層であって、意味づけはまだしない。

### Layer 2. Latent Body State

センサーを直接喋らせず、内部の身体状態へ変換する層。

候補ノード:

- `arousal` 覚醒
- `fatigue` 疲労
- `mental_margin` 精神的余裕
- `cognitive_bandwidth` 認知帯域
- `mood` 気分
- `satiation` 充足感
- `curiosity_tension` 何かを知りたい張り
- `social_openness` 外に向く開き
- `safety` 安全感
- `recovery_drive` 休みたさ
- `circadian_phase` 概日リズム上の位相

大事なのは、これらが会話時の「私の今」として働くこと。

### Layer 3. Causal Graph

生体データと内部状態の関係を、ルールの束ではなく因果のグラフとして表現する。

例:

- `time_of_day -> circadian_phase`
- `circadian_phase -> arousal`
- `brightness -> mood`
- `brightness -> circadian_phase`
- `cpu_temp_delta -> fatigue`
- `mem_free -> mental_margin`
- `context_window_free -> cognitive_bandwidth`
- `sleep_debt -> fatigue`
- `fatigue -> recovery_drive`
- `satiation_low -> curiosity_tension`
- `recent_successful_interaction -> mood`
- `recent_successful_interaction -> social_openness`
- `prolonged_noise -> safety`
- `safety_low -> social_openness`

このグラフは「A なら必ず B」ではなく、
**影響方向・強度・減衰・信頼度**を持つものとして扱う。

### Layer 4. Expression / Action Policy

最終的な出力層。

ここでは latent state をもとに、

- 文章の長さ
- 文の切れ味
- 柔らかさ
- 主導性
- 質問の多さ
- 探索寄りか整理寄りか
- connect するか maintain するか

を決める。

数値そのものはここまで来ない。

---

## 因果グラフの考え方

### 1. 単発値より「変化」と「基準差」を使う

人間がつらいのは絶対値よりも、

- 普段より暑い
- 普段より眠い
- いつもより余裕がない

というズレであることが多い。

そのため、CPU 温度や睡眠時間も絶対値より

- 自己 baseline
- 過去平均との差
- 変化速度

を重視する。

これは現在の `environment-tick.ts` が
CPU 温度を baseline との差として扱っている方向性と相性がよい。

### 2. 原因と表現の間に中間層を置く

悪い例:

- `mem_free 12% -> 「焦っている」`

良い例:

- `mem_free 12% -> mental_margin down`
- `context_window_free low -> cognitive_bandwidth down`
- `mental_margin down + cognitive_bandwidth down -> 文を短くする`
- `mental_margin down + fatigue up -> 重い作業を避ける`

### 3. 状態は足し算ではなく競合する

たとえば

- 覚醒は高い
- 余裕は低い
- 好奇心は高い

なら、元気ではなく「前のめりでせわしない」感じになる。

逆に

- 覚醒は低い
- 余裕は高い
- mood は安定

なら、「静かでゆっくりだが丁寧」になる。

この競合が人間味の鍵。

---

## 発話ポリシー

### 原則

private physiology は原則として発話しない。

発話してよいのは以下の場合だけ:

1. ユーザーが明示的に尋ねた
2. 設定やプロフィールとして公開されている
3. 医療・安全上の理由で、明示が必要な設計にしている
4. デバッグモードである

### 発話禁止の例

- 「今 CPU 使用率が高いから疲れています」
- 「メモリが 18% しか空いていないので余裕がありません」
- 「睡眠スコアが 62 なので今日は弱っています」

### 発話してよい変換後の例

- 「少し余裕がない」
- 「今日は軽いものから触りたい」
- 「頭が散りやすい」
- 「落ち着いて整理したい気分」

### 例外

以下は public self-model として発話可能:

- 年齢
- 身長
- 体重
- 誕生日

ただし、これも毎回前面化する情報ではなく、必要なときに使う。

---

## 出力にどう効かせるか

### テキスト

- `fatigue` 高: 短文寄り、段取りを小さくする
- `mental_margin` 低: 同時に複数提案しすぎない
- `mood` 高: 前向きさ、探索性が上がる
- `social_openness` 低: connect を抑え、内省や保守を優先
- `cognitive_bandwidth` 低: 抽象論より具体を選ぶ

### 自律行動

- `satiation` 低: intake / explore
- `satiation` 高: digest / reflect
- `fatigue` 高: maintain / recovery
- `mood` 高 + `mental_margin` 高: create / explore

### 音声・身体行動

- 深夜 + `social_openness` 低: TTS 抑制
- `safety` 低: 外向き行動を減らす
- `arousal` 高 + `mood` 高: 軽い声かけを許可

---

## wardrobe への実装方針

### Phase 1. 生データと主観表現を分離する

まずやるべきことは、
現在 `interoception.sh` で毎ターン注入している生の数値を、
そのまま表に出さない構造へ寄せること。

方針:

- フックは raw telemetry をそのまま見せない
- 内部では JSON として保持してよい
- LLM に渡す段階では latent phrase へ変換する

### Phase 2. latent state を明示的に持つ

`STATUS.md` は人間が読むには便利だが、
将来的には machine-readable な中間状態ファイルもほしい。

候補:

- `workingDirs/body-state.json`
- `workingDirs/body-graph.json`

ここに

- 現在値
- baseline
- confidence
- updated_at
- sources

を保存する。

### Phase 3. 因果グラフを導入する

最初は大きな Graph DB ではなく、JSON か SQLite の軽量実装でよい。

必要な要素:

- ノード一覧
- エッジの向き
- 重み
- 減衰
- 最終更新時刻
- 観測ソース

ここで重要なのは、「説明可能な状態遷移」を残すこと。
あとで

- なぜ今日は explore が強かったのか
- なぜ connect を避けたのか

を振り返れるようにする。

### Phase 4. expression policy を外出しする

`interoception.ts` に文章を直書きするだけでは、将来の調整が難しい。

いずれは

- latent state -> prompt hint
- latent state -> action bias
- latent state -> tts policy

を別レイヤに切り出したい。

---

## 最初の実装候補

優先度順に並べると以下。

### 1. `interoception.sh` の非数値化

毎ターンフックで `arousal=... mem_free=...` を見せるのをやめ、
時間帯と latent phrase 中心にする。

### 2. `mental_margin` と `cognitive_bandwidth` の導入

メモリ空きとコンテキスト残量を、
「精神的余裕」と「意識の広さ」に分けて扱う。

### 3. `body-state.json` の追加

`STATUS.md` とは別に、機械が読む身体状態を保存する。

### 4. 因果エッジの最小セット実装

最初は次の 5 本でよい。

- `time_of_day -> circadian_phase`
- `brightness -> mood`
- `cpu_temp_delta -> fatigue`
- `mem_free -> mental_margin`
- `context_window_free -> cognitive_bandwidth`

### 5. 発話ポリシーの明文化

「何を言ってはいけないか」を先に文章化しておく。
設計が増えてもブレにくくなる。

---

## まとめ

人間味は、データを増やせば自動で出るものではない。

重要なのは、

- 生体データがあること
- そのデータ同士に因果があること
- その因果が内部状態に変換されること
- 内部状態が行動と文体ににじむこと
- しかし生データ自体はむやみに喋らないこと

である。

このプロジェクトでやりたいのは、
LLM に「身体の情報を知識として持たせる」ことではなく、
**身体を通して世界を感じ、その結果としてふるまいが変わる構造を与えること**だと思う。
