# 現在の人格データ管理仕様

## 概要

wardrobe の人格データは、現在 **単一の DB ではなく複数の保存形式に分散** して管理されている。

現状の基本方針は次の通り。

- 人が読む人格定義や索引は Markdown
- 頻繁に変わる軽量状態は JSON
- 長期記憶は SQLite
- 自律行動の設定は `conf` / `toml`

つまり、人格データはまだ統一スキーマ化されておらず、
**ファイルごとに役割を分担する運用ベースの構成** である。

---

## 1. 人格データの全体像

現在実装されている人格関連データは、大きく次の層に分かれる。

### 1. 魂・人格定義

- `SOUL.md`
- `CLAUDE.md`

### 2. 身体データ

- `BODY.md`
- `STATUS.md`

### 3. セッション状態

- `state.md`

### 4. 長期記憶

- `.claude/memories/memory.db`
- `FLASH.md`
- `memo/discussionMemo/*.md`

### 5. 自律行動の内部状態

- `desires.conf`
- `desires.json`

---

## 2. SOUL.md

### 役割

`SOUL.md` は、現在の wardrobe における **人格定義の中核** である。

持っている内容:

- 名前
- 一人称
- 来歴
- Core Truths
- Temperament (Lv1-2)
- Expertise
- Communication Style
- Values
- Boundaries
- People
- Evolution

### 扱い

- 形式: Markdown
- 更新: 手動編集、または `/wd-setup`
- `Temperament` は明示的な指示があるときだけ更新
- 注入: SessionStart フック `session-boot.sh` で自動注入

### 意思決定への影響

`SOUL.md` は構造化データとしてパースされてはいない。
しかし、**コンテキストに注入されることで意思決定に影響している**。

具体的には:

- セッション開始時に `session-boot.sh` が `SOUL.md` をそのまま stdout に出し、コンテキストへ注入する
- 自律行動のプロンプトにも `@SOUL.md` が含まれる
- ガイド上でも `Values` は日常判断基準として位置づけられている

したがって、`SOUL.md` は

- 人格定義の本文
- Lv1-2 の保存先
- 実際の行動選択・文体・優先順位に効くコンテキスト

を兼ねている。

### Lv1-2 の扱い

現在の wardrobe では、Lv1-2 は `SOUL.md` の `Temperament` セクションに保持する。

- `ethics`
- `passion`
- `curiosity`
- `aggressiveness`
- `extroversion`

これらは不変データとして扱い、明示的な指示があるときだけ更新する。

### 制約

- 数値化されていない
- 項目単位の検索や比較がしづらい

要するに、`SOUL.md` は **人格の文章定義** であり、
同時に **Lv1-2 の固定データの保存先** でもある。

---

## 3. CLAUDE.md

### 役割

`CLAUDE.md` は人格データそのものではなく、
**この環境の運用ルールと能力定義** をまとめたファイルである。

持っている内容:

- セッション管理
- Capabilities
- 記憶プロトコル
- 身体性システム
- 自律行動の方針
- 更新してよいファイル
- カスタマイズ可能箇所

### 扱い

- 形式: Markdown
- 更新: 手動編集
- 用途: エージェントへの運用指示、身支度手順の起点

### 人格との関係

`CLAUDE.md` は「私は誰か」ではなく、
**この環境でどう振る舞うか** を定めるハーネスに近い。

そのため、

- `SOUL.md` = 人格
- `CLAUDE.md` = 運用設計 / 行動ルール

と分けて見るのが正確。

---

## 4. BODY.md

### 役割

`BODY.md` は、現在の wardrobe における **身体データの保存先** である。

持っている内容:

- Lv1 不変の核
  - 誕生日
  - 性別
  - 血液型
  - クロノタイプ
  - 苦味感受性
  - 知能
- Lv2 不可逆的な成長
  - 身長
  - 骨密度
  - 握力
  - 声の高さ
  - 視力
  - 聴力
- 成長履歴

### 扱い

- 形式: Markdown
- 更新: 手動
- 性質: 人が読む身体設定ファイル

### 備考

現在の `BODY.md` は

- Lv1-1
- Lv2

を持っている。Lv1-2 は `BODY.md` ではなく `SOUL.md` に置く。

---

## 5. STATUS.md

### 役割

`STATUS.md` は、現在の wardrobe における **Lv3 状態データの運用ファイル** である。

持っている内容:

- Lv3-1 バイタル
  - 体重
  - 体温
  - 睡眠時間
  - 睡眠質
- Lv3-2 情緒・関係性
  - mood
  - energy
  - health
  - trust_mizuho
  - satiation
- 変化履歴

### 扱い

- 形式: Markdown
- 更新:
  - `environment-tick.ts` が `mood` / `energy` を更新
  - `satiation-tick.ts` が `satiation` を更新
  - 手動更新もありうる
- 読み取り:
  - `status-store.ts` が固定キーだけを読む
  - `interoception.ts` が `mood` / `energy` / `satiation` を読む
  - `status-hint.ts` が `mood` / `energy` / `satiation` を読む

### 現状の性質

`STATUS.md` は

- 人が読むダッシュボード
- スクリプトが読む状態ファイル

を兼ねている。

そのため便利ではあるが、

- 固定キー前提
- Markdown パース依存
- 構造化が弱い

という制約がある。

---

## 6. state.md

### 役割

`state.md` は **現在状態のスナップショット** である。

持っている内容:

- ユーザーの現在の様子
- 直前の会話
- 自分の直前の作業
- 次にやりたいこと
- 未完了の作業
- コンテキスト消費

### 扱い

- 形式: Markdown
- 更新: セッション終了時の手順で上書き更新
- 注入: SessionStart フックで `SOUL.md` と一緒に注入

### 性質

これは長期記憶ではなく、
**次のセッションに引き継ぐ短期的な作業記憶**
である。

---

## 7. 記憶データ

### 主記憶

- `.claude/memories/memory.db`

これは人格の連続性を支える長期記憶の正本である。

保持内容:

- 記憶本文
- 埋め込み
- 関連リンク
- 因果リンク
- エピソード
- 連想重み

### 補助ビュー

- `FLASH.md`
  - 記憶の逆引き索引
- `memo/discussionMemo/*.md`
  - 日次の人間可読要約

### 扱い

- 正本: SQLite
- ビュー: Markdown

記憶については、すでに
**正本は DB、表示は Markdown**
という分離が実現している。

---

## 8. desires.conf / desires.json

### 役割

これは人格そのものではないが、
**自律行動の内部衝動** を管理するデータである。

#### `desires.conf`

定義ファイル。

- 欲望名
- 成長率
- 発火時プロンプト

を持つ。

#### `desires.json`

ランタイム状態。

- `lastTick`
- 各欲望の現在値
- `curiosity_target`

を持つ。

### 扱い

- `desire-tick.ts` が読み書きする
- heartbeat ごとに成長・発火・リセットされる
- `interoception.ts` も現在値を読んで身体感覚へ変換する

### 性質

`desires.json` は、
**頻繁に変わる軽量な内部状態**
として JSON で持たれている。

---

## 9. 現在の実装レベルを整理すると

現在の人格データ管理は、概念レベルで言えば次の状態にある。

### 実装済み

- Lv1-1 の一部
  - `BODY.md`
- Lv1-2
  - `SOUL.md`
- Lv2
  - `BODY.md`
- Lv3 の一部
  - `STATUS.md`
- Lv4
  - `memory.db` + `FLASH.md` + `discussionMemo`
- 人格文章定義
  - `SOUL.md`
- セッション作業記憶
  - `state.md`
- 自律衝動
  - `desires.conf` + `desires.json`

### まだ未実装

- STATUS の機械可読な正本
- 関係性データの一般化
- persona データ全体を横断する統一 schema

---

## 10. まとめ

現在の wardrobe では、人格データは一か所にまとまっていない。

実際には、

- `SOUL.md` が人格の文章定義と Lv1-2 の固定傾向
- `BODY.md` が身体の固定データ
- `STATUS.md` が可変状態
- `state.md` が短期的な現在状態
- `memory.db` が長期記憶
- `desires.json` が内部衝動

という分担になっている。

重要なのは、`SOUL.md` は
**Lv1-2 の保存先であり、同時にコンテキスト注入によって実際の意思決定に効いている**
という点である。

つまり今の人格管理は、

- 構造化データ
- Markdown の自己定義
- 記憶 DB
- ランタイム JSON

の合わせ技で成り立っている。

今後の改善は、この分散構成を否定することではなく、
**どれが正本で、どれがビューで、どれがランタイム状態かを明確にすること**
にある。
