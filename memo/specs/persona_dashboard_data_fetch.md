# persona dashboard データ取得仕様

## 概要

この文書は、2026-04-19 時点の `persona-dashboard.ts` / `persona-data.ts` / `persona-dashboard-client.js` を基準にした、
**dashboard がどこからデータを取得し、どう組み立てて表示しているか** の現行仕様メモである。

重要なのは、dashboard は単純に SQLite を読んでいるわけではなく、**表示対象によって取得元が異なる**こと。

- 現在値・履歴・環境観測一覧:
  - Markdown をその場でパースした結果を使う
- 因果 graph:
  - Kuzu snapshot を優先し、失敗時は seed JSON にフォールバックする
- 因果 trace:
  - Kuzu trace を優先し、現在値の付与には SQLite の `persona_current` を使う

---

## エントリポイント

dashboard のサーバー本体は `.claude/scripts/persona-dashboard.ts` で、`Bun.serve` により HTTP サーバーを立てる。

- 既定 host: `127.0.0.1`
- 既定 port: `4318`

公開エンドポイントは次の通り。

- `/`
  - HTML を返す
- `/api/dashboard`
  - dashboard 全体の JSON payload を返す
- `/api/causal-trace`
  - 選択ノード用の因果 trace JSON を返す
- `/persona-dashboard.js`
  - クライアントスクリプトを返す
- `/health`
  - `ok`

---

## データソース

dashboard が参照する主なデータソースは次の通り。

### 1. Markdown

- `SOUL.md`
- `BODY.md`
- `STATUS.md`
- `ENVIRONMENT.md`

これらは `readPersonaDashboardSnapshot()` の冒頭で毎回読み込まれる。

用途:

- `SOUL.md`
  - 名前、一人称、Temperament 系メトリクス
- `BODY.md`
  - Lv1-1 / Lv2 の現在値と成長履歴
- `STATUS.md`
  - Lv3 の現在値と変化履歴
- `ENVIRONMENT.md`
  - Lv0 環境の現在値と変化履歴

### 2. seed JSON

- `.claude/persona/causal-seeds.json`

用途:

- SQLite の `causal_nodes` / `causal_edges` への同期元
- Kuzu が読めないときの graph fallback 元

### 3. SQLite

- `.claude/workingDirs/persona-status.sqlite`

用途:

- `syncPersonaStructuredStore()` による構造化保存先
- 因果 trace 表示時の `currentMetric` 付与元
- dashboard 上では `dbPath` 表示用にも使う

ただし、**現在値・履歴の main source ではない**。
現行 dashboard は SQLite を primary read source にしていない。

### 4. Kuzu

用途:

- 因果 graph snapshot の取得
- upstream / downstream trace の取得

---

## サーバー側の組み立てフロー

## 1. 初回ページ表示

`/` が呼ばれると、サーバーは `buildPayload()` を実行して HTML を返す。

このとき payload は次で構成される。

- `generatedAt`
- `dbPath`
- `meta`
- `current`
- `history`
- `observations`
- `graph`
- `trace`

この payload は HTML 内の `initial-dashboard-data` script tag に JSON として埋め込まれる。

つまり初回描画は、

- まず HTML + 初期 JSON をサーバーが返し
- クライアントはその inline JSON を読む

という SSR に近い構成になっている。

## 2. `/api/dashboard`

30 秒ごとの再読み込み時には、クライアントが `/api/dashboard` を fetch する。

`/api/dashboard` の payload 生成は `buildPayload()` が担当する。

中ではまず `readPersonaDashboardSnapshot()` が呼ばれる。

### `readPersonaDashboardSnapshot()` の処理順

1. `SOUL.md`, `BODY.md`, `STATUS.md`, `ENVIRONMENT.md` を読む
2. `buildDashboardSnapshotFromMarkdownDocuments()` で Markdown をその場でパースする
3. `syncPersonaStructuredStore()` を試みる
4. graph は Kuzu snapshot を読む
5. Kuzu graph が取れなければ seed JSON をそのまま graph 化する

ここで重要なのは、

- `meta`
- `current`
- `history`
- `observations`

は **Markdown から直接作った snapshot** が返されること。

`syncPersonaStructuredStore()` は走るが、それは主に

- SQLite を最新化する
- Kuzu を同期する

ための side effect であり、現行 dashboard はその直後に SQLite を main source として再読込はしていない。

## 3. `/api/causal-trace`

選択ノードの trace は `/api/causal-trace?key=...&direction=...&depth=...` で個別取得する。

クライアントが trace を再取得する契機は次の通り。

- metric card を選択したとき
- graph node を選択したとき
- direction を切り替えたとき
- depth を切り替えたとき

初期表示では `energy` の trace を preload している。

---

## `syncPersonaStructuredStore()` の役割

`syncPersonaStructuredStore()` は dashboard の read path と密接に結びついているが、
役割は **表示データの primary fetch** ではなく **構造化 mirror の更新** である。

実施内容は次の通り。

1. Markdown 群を読む
2. `parseSoulDocument()`
3. `parseBodyDocument()`
4. `parseStatusDocument()`
5. `parseEnvironmentMarkdown()`
6. SQLite の `persona_current` を Markdown 由来データで置き換える
7. SQLite の `persona_history` を Markdown 由来データで置き換える
8. `persona_meta` を upsert する
9. `causal-seeds.json` から SQLite の `causal_nodes` / `causal_edges` を再投入する
10. 最後に `syncKuzuCausalGraph()` を試みる

つまり dashboard の背後では、

- Markdown -> SQLite
- seed JSON -> SQLite
- SQLite/seed -> Kuzu

という同期が定期的に走っている。

---

## 表示項目ごとの実際の取得元

### `meta`

取得元:

- `SOUL.md`

備考:

- `name`
- `first_person`

を抽出する。

### `current`

取得元:

- `SOUL.md`
- `BODY.md`
- `STATUS.md`
- `ENVIRONMENT.md`

備考:

- すべて Markdown パース結果の結合
- environment は `parseEnvironmentMarkdown()` により `Lv0` metric として注入される

### `history`

取得元:

- `BODY.md`
- `STATUS.md`
- `ENVIRONMENT.md`

備考:

- Markdown 上の履歴テーブルから作る
- 最大 300 件に絞る

### `observations`

取得元:

- `ENVIRONMENT.md` の履歴

備考:

- `environment_observations` SQLite テーブルではなく、
  現在は `ENVIRONMENT.md` 履歴から派生させている
- 最大 120 件に絞る

### `graph`

取得元:

- 第 1 優先: Kuzu snapshot
- fallback: `.claude/persona/causal-seeds.json`

備考:

- dashboard 全体に出す graph は `readKuzuCausalGraphSnapshot()` を優先する
- Kuzu が取れない場合でも seed JSON ベースで可視化は継続する

### `trace`

取得元:

- 第 1 優先: Kuzu trace bundle
- fallback: SQLite 上の `causal_nodes` / `causal_edges`

補助データ:

- `currentMetric` は SQLite `persona_current`

備考:

- trace のノードには、同じ key の現在値を `currentMetric` として付与する
- そのため trace は graph 単体よりも SQLite 依存が少し強い

---

## クライアント側の取得フロー

クライアント本体は `.claude/scripts/persona-dashboard-client.js`。

流れは次の通り。

1. `initial-dashboard-data` を読む
2. 初期描画する
3. 30 秒ごとに `/api/dashboard` を再取得する
4. 選択 trace が payload 内 trace と一致しなければ `/api/causal-trace` を追加で取りに行く

したがってクライアントは、

- ファイルを直接読まない
- SQLite を直接読まない
- Kuzu を直接読まない

すべてサーバー経由の JSON を描画している。

---

## fallback と失敗時の挙動

### 1. SQLite / sync の失敗

`readPersonaDashboardSnapshot()` は `syncPersonaStructuredStore()` を試すが、
失敗しても Markdown snapshot 自体はすでに手元にある。

そのため、

- SQLite 同期失敗
- database lock

が起きても、dashboard 自体は Markdown ベースで表示継続できる。

### 2. Kuzu graph 取得失敗

graph は seed JSON へフォールバックする。

そのため、

- graph の線が完全に消える

のではなく、

- 既知の seed graph を表示する

挙動になる。

### 3. Kuzu trace 取得失敗

trace は SQLite 上の `causal_nodes` / `causal_edges` を使った再帰 trace にフォールバックする。

そのため、

- Kuzu bundle 由来の trace
- SQLite graph 由来の trace

の二段 fallback がある。

### 4. 初期 JSON の parse 失敗

クライアント側は boot error を表示する。

---

## 現状の注意点

### 1. dashboard はまだ Markdown-first

現行実装では、dashboard の main 表示は SQLite-first ではない。

つまり、

- SQLite は mirror / trace 補助 / graph 補助
- main の値と履歴は Markdown

という構成になっている。

### 2. `environment_observations` テーブルは main source ではない

SQLite には `environment_observations` テーブルがあるが、
dashboard の `observations` は現在そこから読んでいない。

現行では `ENVIRONMENT.md` 履歴から再構成している。

### 3. 初期 trace は `energy`

初回ページロード時に preload する trace は固定で `energy`。
選択変更後のみ `/api/causal-trace` が個別再取得される。

---

## まとめ

dashboard のデータ取得は、現状では次のように整理できる。

- 現在値と履歴:
  - Markdown 直読み
- 構造化 mirror:
  - SQLite に同期
- 因果 graph:
  - Kuzu 優先、seed fallback
- 因果 trace:
  - Kuzu 優先、SQLite fallback
- クライアント:
  - サーバー JSON のみ利用

つまり現行 dashboard は、
**Markdown を正本としつつ、SQLite と Kuzu を補助的に使うハイブリッド取得構成**
になっている。
