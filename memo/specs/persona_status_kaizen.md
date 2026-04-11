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

これも現状は存在しない。
[mizuho]なくていいかな。ユーザへのtrustと似たようなものだ。またはlv1-2の外向性（人懐こさ）

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
削るべきものではなく、**spec 側へ逆輸入して正式項目化すべき候補** である。

特に:

- `energy` は疲労・回復・活動強度の中核
- `satiation` は「飽き/満ち/探索欲」の制御に使える

ため、現在の wardrobe では重要度が高い。
[mizuho]energyとhealthの違いがわからない。

### 2-4. 1ユーザー前提の項目名になっているもの

現状の `trust_mizuho` は、目標設計の `trust` と比べると特殊化しすぎている。

問題:

- ユーザーが複数になったとき壊れる
- persona の状態と、persona-user 関係が混ざっている
- status の中に個別ユーザー名が埋め込まれている

これは将来的に

- `trust`
- `friendliness`
- `attachment`

のような一般化された関係性ノードに寄せるか、
もしくは `memo/users/` や別テーブルに切り出す必要がある。

---

## 3. 項目以外の構造的な不足

本質的には、問題は「項目数」だけではない。
今の `STATUS.md` はデータ構造としても目標仕様よりかなり簡略化されている。


### 3-2. status-store.ts が固定キー前提

現在コード側で正式に扱うラベルは固定されている。

- `mood`
- `energy`
- `health`
- `trust_mizuho`
- `satiation`

つまり、新しい status を `STATUS.md` に行追加しても、
コードが自動的に使えるわけではない。

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


### 3-5. 表示層と保存層が分離していない

本来は

- 機械が読む保存層
- 人間が読む要約層

を分けたほうがよい。

現状は `STATUS.md` がその両方を兼ねているため、

- 実装の自由度が低い
- schema 拡張がしづらい
- 自然言語の説明と数値データが混ざる

という問題がある。

---

## 4. 何を残し、何を変えるべきか

### 残すべきもの

現在の `STATUS.md` には、目標 schema にはまだ表現されていないが、
wardrobe の実運用で有効な考え方がすでに入っている。

残すべきもの:

- `energy`
- `satiation`
- heartbeat ごとの更新
- 理由つき履歴
- 情緒とバイタルの分離

これらは「暫定実装」ではなく、今後の正式設計に取り込むべき資産。

### 変えるべきもの

改善対象:

- `trust_mizuho` の特殊化
- Markdown 依存の status parsing
- バイタルの未実装項目
- `STATUS.md` だけに依存する保存設計

---

## 5. 改善方針

### 方針1. `STATUS.md` は表示層に寄せる

今後の理想は、

- `STATUS.md` = 人間向け要約
- JSON / SQLite = 機械向け保存

である。

`STATUS.md` は捨てるのではなく、
可読なダッシュボードとして残したほうが運用しやすい。

### 方針2. status を schema 準拠に寄せる

機械側では、少なくとも以下の情報を構造化して持ちたい。

- `label`
- `value`
- `unit`
- `source`
- `confidence`
- `recorded_at`
- `recorded_for_persona`

### 方針3. spec 側に `energy` と `satiation` を追加する

現在の運用で重要な `energy` と `satiation` は、
目標設計から漏れているだけで、不要な概念ではない。

候補:

- `energy` を Lv3-2 へ追加
- `satiation` を Lv3-2 もしくは別カテゴリとして追加

`satiation` は感情でもバイタルでもない中間概念なので、
将来的には「行動駆動状態」として独立させる案もある。

### 方針4. trust を関係性データとして一般化する

`trust_mizuho` は暫定運用としては便利だが、長期設計には向かない。

候補:

- `trust` を Lv3-2 の一般項目に戻す
- ユーザーごとの trust は別ストアに分離する
- `memo/users/<user>.md` か relation table で管理する

### 方針5. バイタルは「値」だけでなく「取得方法」を持つ

たとえば `weight` なら、

- 実測
- 推定
- ユーザー申告
- 外部 API

を区別できるべき。

現状の `STATUS.md` では取得方法カラムがあるのはよいが、
コード上の構造として保持されていない。

---

## 6. 優先順位

### 優先度A: すぐやる

- `persona_status_data.md` に `energy` と `satiation` を正式反映する
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
- `friendliness`

の追加

### 優先度D: 設計の深化

- relation 系 status の切り出し
- graph / vector との連携
- status と causal graph の接続

---

## 7. 改善後のイメージ

理想的には以下のような役割分担になる。

### BODY.md

- Lv1
- Lv2
- 公開してよい身体属性

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
- 一般化
- 保存層の分離
- relation status の整理

にある。

今後は `STATUS.md` を中心に無理やり拡張するより、
**STATUS を表示層として残しつつ、機械可読な本体を別に持つ** 方向がよさそう。
