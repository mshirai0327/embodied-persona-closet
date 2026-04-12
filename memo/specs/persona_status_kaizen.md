# persona_status_kaizen.md

## STATUS 改善メモ

### 一言でいうと

現在の `STATUS.md` は、`persona_status_data.md` や `persona_schema.dbml` が目指している
人格データ設計の **MVP / 運用版** であり、まだ目標スキーマの完全実装ではない。

今できていることは、

- mood / energy / health / trust / satiation の更新
- 一部バイタルの保持
- heartbeat への反映

である。

一方で、足りないのは

- 項目そのもの
- 項目の意味の整理
- 関係性の一般化
- 履歴と単位の構造化
- 機械可読な保存層

である。

---

## 1. 現状の STATUS.md は何者か

現在の `STATUS.md` は、Lv3 のうち一部だけを人間可読な Markdown で管理するファイルである。

実際に運用されている項目は次の通り。

### Lv3-1 バイタル

- 体重
- 体温
- 睡眠時間
- 睡眠質

### Lv3-2 情緒・関係性

- mood
- energy
- health
- trust_mizuho
- satiation

ただし、実際にコードが安定して読んでいるのは主に以下。

- `mood`
- `energy`
- `health`
- `trust_mizuho`
- `satiation`

つまり、現状の `STATUS.md` は
**人格設計の完全な status storage** というより、
**heartbeat / interoception / autonomous-action のための運用中の状態ファイル**
と捉えるのが正確。

---

## 2. 目標仕様との差分

`persona_status_data.md` の目標仕様と比べると、差分は大きく 4 種類ある。

### 2-1. まだ存在しない項目

Lv3-1 の目標項目:

- `body_fat_percentage`
- `blood_sugar`
- `blood_pressure_sys`
- `blood_pressure_dia`

これらは現状の `STATUS.md` に存在しない。

Lv3-2 の目標項目:

- `friendliness`

`friendliness` は追加しない。

理由:

- ユーザーへの `trust` と近い
- 「人懐こさ」は Lv1-2 の `extroversion` に寄せられる

### 2-2. 項目はあるが、実体が空のもの

現状 `STATUS.md` にはあるが、まだ実測・更新系がつながっていないもの:

- `body_temperature`
- `sleep_time`
- `sleep_quality`

これらは行としては存在するが、値は `—` のままで、センサーも更新ロジックも未接続。

### 2-3. 目標仕様にはないが、現在の wardrobe に重要な項目

現在の `STATUS.md` には、元の spec にないが、運用上かなり重要な項目がある。

- `energy`
- `satiation`

この 2 つは heartbeat の行動選択や interoception の身体感覚変換に使われており、
削らず、spec 側へ正式項目として追加する。

特に:

- `satiation` は「飽き/満ち/探索欲」の制御に使える

ため、現在の wardrobe では重要度が高い。

ただし `energy` には重要な語義の問題がある。

現在 runtime で使われている `energy` は、
CPU 温度や回復量から更新されているため、実態としては

- 疲労
- 身体負荷
- 回復しやすさ

の proxy に近い。

一方で、`energy` を「活力」と呼ぶなら、
本来は

- 活動したい気力
- 前に出る力
- 行動の駆動力

を意味する。

したがって今後は、

- `energy` = 気力 / activity / volition
- `health` = 体調の安定感・健康感
- `fatigue` または `body_load` = 現在の CPU 温度 proxy に近い負荷

この形に整理し、現在の `energy` を再定義または分割する。

### 2-4. 1ユーザー前提の項目名になっているもの

現状の `trust_mizuho` は、目標設計の `trust` と比べると特殊化しすぎている。

問題:

- ユーザーが複数になったとき壊れる
- persona の状態と persona-user 関係が混ざっている
- status の中に個別ユーザー名が埋め込まれている

優先度は低い。
単一ユーザー運用の間は維持し、後で一般化する。

---

## 3. 項目以外の構造的な不足

本質的には、問題は「項目数」だけではない。
今の `STATUS.md` はデータ構造としても目標仕様よりかなり簡略化されている。

### 3-1. status-store.ts が固定キー前提

現在コード側で正式に扱うラベルは固定されている。

- `mood`
- `energy`
- `health`
- `trust_mizuho`
- `satiation`

つまり、新しい status を `STATUS.md` に行追加しても、
コードが自動的に使えるわけではない。

### 3-2. Markdown 依存

現在の status 読み書きは `STATUS.md` の表形式に依存している。

そのため:

- 項目追加に弱い
- 表記揺れに弱い
- 機械可読性が低い
- schema に沿った拡張がしづらい

という制約がある。

### 3-3. 単位・取得方法・信頼度・観測ソースが構造化されていない

目標 schema は `value Json [{label, value, unit}]` を前提にしているが、
現状の `STATUS.md` ではそれらが Markdown の文中に散っている。

足りない構造情報:

- `unit`
- `source`
- `method`
- `confidence`
- `recorded_at`
- `recorded_for_persona`

特にバイタルでは、
「推定値なのか、センサー値なのか、ユーザー申告なのか」が
データ構造として区別されていない。

### 3-4. 履歴構造が情緒寄り

現状の変化履歴は、

- `項目`
- `変化前`
- `変化後`
- `理由`

という情緒的なログに向いている。

しかしバイタルの履歴としては、

- 単位
- 観測方法
- 計測時刻
- persona 時刻
- センサー名

のような情報が足りない。

### 3-5. 表示層と保存層が分離していない

保存層と表示層は分ける。

現状は `STATUS.md` がその両方を兼ねているため、

- 実装の自由度が低い
- schema 拡張がしづらい
- 自然言語の説明と数値データが混ざる

という問題がある。

---

## 4. 参考: この repo の他データはどう管理されているか

このリポジトリは、すでに単一形式ではなく、**用途ごとに保存形式を使い分ける**
ハイブリッド構成になっている。

### 4-1. SQLite

主記憶は SQLite で管理されている。

- `.claude/memories/memory.db`

ここが記憶の source of truth であり、

- 記憶本文
- 埋め込み
- 連想
- 因果リンク
- エピソード

などを保持する。

`FLASH.md` や `memo/discussionMemo/` はこの DB の二次ビューであり、
正本そのものではない。

### 4-2. JSON

軽量で可変なランタイム状態は JSON が多い。

- `desires.json`
  欲望レベルと `curiosity_target` の保存
- `.claude/workingDirs/system-health-history.json`
  システムヘルス履歴
- `.claude/workingDirs/discussion-memo-state.json`
  discussionMemo の重複防止状態
- `/tmp/interoception_state.json`
  heartbeat-daemon が出力する身体状態の短期スナップショット
- `/tmp/context_usage.json`
  statusline hook が保存するコンテキスト使用量

つまり JSON は、
**軽量・頻繁更新・単純構造・ローカル状態**
の保存先として使われている。

### 4-3. JSONL

バッファ用途には JSONL も使われている。

- hearing 系の `hearing_buffer.jsonl`

これは append-only で扱いやすく、
リアルタイムバッファに向いている。

### 4-4. Markdown

人間が読むべき人格・状態・索引は Markdown が中心。

- `SOUL.md`
- `BODY.md`
- `STATUS.md`
- `FLASH.md`
- `memo/discussionMemo/*.md`

Markdown は、

- 人が読む
- 手で直す
- ニュアンスを書く
- 履歴を眺める

のに向いている。

### 4-5. TOML / conf

設定は別形式になっている。

- `prompts.toml`
- `mcpBehavior.toml`
- `desires.conf`
- `schedule.conf`

### 4-6. この構成から見えること

すでに repo 全体では、

- 重くて検索・部分取得したい正本 = SQLite
- 軽量な可変状態 = JSON
- 人間向けの意味・索引・ダッシュボード = Markdown

という役割分担ができている。

したがって `status` の正本を Markdown に置き続けるのは不整合である。

---

## 5. 何を残し、何を変えるべきか

### 残すべきもの

現在の `STATUS.md` には、目標 schema にはまだ表現されていないが、
wardrobe の実運用で有効な考え方がすでに入っている。

残すべきもの:

- `satiation`
- heartbeat ごとの更新
- 理由つき履歴
- 情緒とバイタルの分離

`energy` は残す。意味は整理する。

### 変えるべきもの

改善対象:

- `energy` / `health` / `fatigue` の意味の混線
- `trust_mizuho` の特殊化
- Markdown 依存の status parsing
- バイタルの未実装項目
- `STATUS.md` だけに依存する保存設計

---

## 6. 改善方針

### 方針1. `STATUS.md` は表示層に寄せる

今後の理想は、

- `STATUS.md` = 人間向け要約
- JSON / SQLite = 機械向け保存

である。

`STATUS.md` は捨てず、可読なダッシュボードとして残す。

### 方針2. status を schema 準拠に寄せる

機械側では、以下の情報を構造化して持つ。

- `label`
- `value`
- `unit`
- `source`
- `confidence`
- `recorded_at`
- `recorded_for_persona`

### 方針3. raw data と prompt data を分ける

ここで言う「取得方法を持つ」は
**LLM に生の測定値をそのまま見せる** ことを意味しない。

分離は次の通り。

- 保存層では測定値・取得方法・信頼度を持つ
- 注入層ではそれを自然言語の身体感覚に変換する

つまり、raw vital は保存し、prompt にはそのまま出さない。

### 方針4. `energy` の語義を整理する

現状の `energy` は、CPU 温度 proxy と結びついているため、
「活力」よりも「疲労 / 負荷 / 回復」寄りの振る舞いをしている。

整理内容:

- `energy` を「気力・活動性」として再定義する
- 現在の CPU 温度 proxy は `fatigue` または `body_load` として切り出す
- `health` は体調全体の健康感として残す

この整理が済むまで、`energy` は定義を固定しない。

### 方針5. `satiation` は正式項目にする

`satiation` は現在の運用でかなり重要であり、
heartbeat と行動選択に効いている。

`satiation` は spec に追加する。

位置づけは Lv3-2 の可変状態とする。

### 方針6. `trust_mizuho` の一般化は後回しにする

`trust_mizuho` は暫定項目として明記し、一般化は後回しにする。

### 方針7. 初期は JSON、拡張後は SQLite にする

初期段階は `body-state.json` を使う。
次の条件が揃ったら SQLite に移す。

- 項目数が増える
- 履歴が増える
- 一部だけ取りたい
- 集計したい
- 複数スクリプトから安定して読み書きしたい

---

## 7. 優先順位

### 優先度A: すぐやる

- `persona_status_data.md` に `satiation` を正式反映する
- `energy` / `health` / `fatigue` の語義整理メモを書く
- `trust_mizuho` を暫定項目として明記し、一般化方針を書く
- `persona_status_kaizen.md` で差分を明文化する

### 優先度B: 近いうちにやる

- `STATUS.md` と別に `body-state.json` か SQLite を追加する
- `status-store.ts` を固定キー前提から拡張可能な構造へ変える
- `body_temperature`, `sleep_time`, `sleep_quality` の更新経路を作る

### 優先度C: 中期的にやる

- `body_fat_percentage`
- `blood_sugar`
- `blood_pressure_sys / blood_pressure_dia`

- `friendliness` は追加しない

### 優先度D: 設計の深化

- relation 系 status の切り出し
- graph / vector との連携
- status と causal graph の接続

---

## 8. 改善後のイメージ

理想的には以下のような役割分担になる。

### BODY.md

- Lv1
- Lv2
- 公開する身体属性

### STATUS.md

- Lv3 の人間可読サマリー
- 今の状態のダッシュボード
- 最近の変化履歴

### body-state.json または DB

- Lv3 の正規データ
- 単位、観測方法、信頼度つき
- スクリプトの読み書き先

### memory / graph

- Lv4 文脈
- status の変化理由との接続
- 因果関係と個人差の学習

---

## まとめ

現在の `STATUS.md` は不完全ではあるが、失敗ではない。
むしろ、

- heartbeat に効く
- interoception に効く
- 行動選択に効く

という意味で、すでに実用的な MVP になっている。

ただし、目標の人格データ設計に届くにはまだ不足がある。

不足は単なる「項目の数」ではなく、

- schema 化
- 語義整理
- 一般化
- 保存層の分離
- relation status の整理

にある。

今後は `STATUS.md` を無理に拡張せず、
**STATUS を表示層として残しつつ、機械可読な本体を別に持つ**。

そして、その方向性はこの repo の既存アーキテクチャとも整合的である。

- 記憶の正本は SQLite
- 軽量な内部状態は JSON
- 人が読む人格・索引・ダッシュボードは Markdown

という使い分けがすでにある。
`status` も同じく

- 正本: JSON / SQLite
- 表示: `STATUS.md`
- 注入: 身体感覚へ変換した短文

に分離する。
