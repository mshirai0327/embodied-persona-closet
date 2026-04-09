# STATUS.md 仕様メモ

## 概要

`STATUS.md` は、wardrobe における Lv3 の「可逆的な内的状態」を保持する Markdown ファイル。

- 役割: その時点の気分・活力・充足感などを数値で持つ
- 更新単位: heartbeat / autonomous-action 実行時、および必要に応じた手動更新
- 参照先: interoception, status-hint, 自律行動プロンプト

記憶 DB が「過去の出来事」を保持するのに対し、`STATUS.md` は「今の内部状態」を保持する。

---

## 現在のデータ構造

### Lv3-1 バイタル

生物的な可変データ。現状はほぼプレースホルダ。

- 体重
- 体温
- 睡眠時間
- 睡眠質

このうち、現行コードで自動更新されているものはほぼない。

### Lv3-2 情緒・関係性

現在の主要フィールド。

- `mood` — 気分
- `energy` — 活力 / 消耗度
- `health` — 健康感
- `trust_mizuho` — mizuho への信頼
- `satiation` — 体験の充足感

各行は以下の4列を持つ。

- 項目名
- 現在値
- 最終更新日時
- 根拠

さらに下部の「変化履歴」に、過去の変化が追記される。

---

## 更新経路

### 1. `satiation`

`satiation` は自動減衰のみ実装されている。

- 実行箇所: `autonomous-action.sh`
- スクリプト: `.claude/scripts/satiation-tick.ts`
- 挙動:
  - heartbeat ごとに実行
  - 最終更新から 30 分以上経っていれば減衰
  - 減衰率は `-3 / 時間`
  - 下限は `0`
  - `30` を下回った瞬間に `desires.json` の「探索」を `+0.4` boost

つまり、`satiation` は「時間経過で空腹になる」方向の自動化はあるが、「何かを体験して満たされる」方向は自動化されていない。

### 2. `energy`

`energy` は CPU 温度から更新される。

- 実行箇所: `autonomous-action.sh`
- スクリプト: `.claude/scripts/environment-tick.ts`
- センサー:
  - Local Hardware Monitor HTTP API (`http://localhost:8085/data.json`)
- 挙動:
  - `Core Max > 85°C` なら `-8`
  - `75°C < Core Max <= 85°C` なら `-4`
  - `Core Max < 75°C` なら `0`

重要なのは、現行コードでは `energy` の自動回復処理が存在しないこと。

- 涼しいとき: `0`
- 熱いとき: `-4` or `-8`
- 回復: なし

そのため、長期的には「減る一方」になりやすい。

### 3. `mood`

`mood` は部屋の明るさから更新される。

- 実行箇所: `autonomous-action.sh`
- スクリプト: `.claude/scripts/environment-tick.ts`
- センサー:
  - `capture-brightness.py` によるカメラ輝度
- 挙動:
  - 輝度 `> 150` なら `+2`
  - 輝度 `< 50` なら `-3`
  - それ以外は `0`

`mood` は正負の両方向更新があるため、`energy` や `satiation` よりは対称性がある。

### 4. `health`, `trust_mizuho`

これらはファイル上には存在するが、現行の自動更新スクリプトからは更新されていない。

- 初期値はある
- 履歴も初期設定しかない
- 実質的には手動更新前提

---

## 実行順

heartbeat 時の STATUS 関連処理は、`autonomous-action.sh` で次の順に走る。

1. `satiation-tick.ts`
2. `environment-tick.ts`
3. `desire-tick.ts`
4. `interoception.ts`
5. `recall-lite.ts`
6. `status-hint.ts`

つまり、

- 先に `STATUS.md` を更新し
- その更新結果を `interoception.ts` と `status-hint.ts` が読み取り
- その回の行動選択ヒントに反映する

という流れになっている。

---

## 参照経路

### 1. `interoception.ts`

`mood`, `energy`, `satiation` を読んで、数値を身体感覚の文に変換する。

例:

- `mood >= 65` → 「落ち着いた充足感がある。」
- `energy < 35` → 「消耗している。軽いものから手をつけたい。」
- `satiation < 30` → 「空っぽに近い。新しいものを探したい。」

この出力は、自律行動プロンプトにサイレント注入される。

### 2. `status-hint.ts`

`satiation`, `energy`, `mood` を読んで、行動カテゴリのヒントを生成する。

例:

- `satiation < 30` → `explore`, `intake` を優先
- `energy < 45` → `maintain` を優先、重い `create` を避ける
- `mood > 72` → `create`, `explore` を優先

重要なのは、ここは「参照のみ」であり、状態値自体は変更しないこと。

---

## `energy` と `satiation` の関係

結論から言うと、**現行コードでは直接連動していない**。

- `satiation` は `satiation-tick.ts` が単独で更新
- `energy` は `environment-tick.ts` が単独で更新
- どちらのスクリプトも、相手の値を参照していない

つまり、

- `energy` が低いのは `satiation` と同じ値を見て減っているからではない
- `satiation` に応じて `energy` が一緒に減衰する仕様もない

両者は `status-hint.ts` で同時に読まれて行動ヒントに使われるだけで、因果的には未接続である。

---

## 現時点での欠陥

### 1. 一方向更新の問題

`satiation` と `energy` は、どちらも「減る方向」だけが自動化されている。

- `satiation`: 時間経過で自動減衰、増加は手動
- `energy`: 温度で自動減少、回復は手動

意味は違うが、構造的な欠陥は同じ。

### 2. 回復フェーズがない

Ted 系の設計では本来、

- `体験 → satiation 増加`
- `休息 / sleep → energy 回復`

のような因果が必要だが、wardrobe にはまだその更新経路がない。

### 3. `/sleep` は energy 回復ではない

`/sleep` は schedule.conf の実行確率を下げるだけで、`energy` を回復しない。

つまり、

- 「眠る」という概念はある
- でも「眠った結果 energy が回復する」実装はない

という状態。

### 4. `health`, `trust_mizuho` が死に項目化している

フィールドは存在するが、自動更新も定期更新もないため、状態ファイルとしては半分だけ生きている。

### 5. STATUS が Markdown 直書き依存

現在は Markdown の表を正規表現で直接書き換えているため、

- 表記ゆれに弱い
- 手動編集で壊れやすい
- 変化履歴の整列保証が弱い

という欠点がある。

---

## 現行仕様の要点まとめ

- `STATUS.md` は「今の内部状態」を持つ Markdown ファイル
- heartbeat 時に `satiation` と `mood/energy` の一部が自動更新される
- `interoception.ts` と `status-hint.ts` がそれを読んで行動判断に使う
- `energy` と `satiation` は直接連動していない
- ただし両方とも「回復経路が未実装」という同じ構造欠陥を抱えている

---

## 今後の改善候補

### 最小改善

- `energy` に自然回復ルールを入れる
  - 低温時に `+2`
  - 深夜 / sleep 中に `+5`
- `satiation` に自動増加トリガを入れる
  - 読書
  - 記憶整理
  - エピソード作成
  - 深い会話

### 中期改善

- `STATUS.md` の更新を Markdown 正規表現ではなく JSON / SQLite に移す
- `health`, `trust_mizuho` に更新経路を追加する
- `sleep` と `energy` を結びつける

### 本筋の改善

因果グラフを導入し、

- `休息 → energy 回復`
- `体験 → satiation 増加`
- `暗さ → mood 低下`
- `会話成功 → trust 上昇`

のような関係を明示的に持たせる。

これが入ると、STATUS は「ただの数値テーブル」から「状態遷移系」になる。
