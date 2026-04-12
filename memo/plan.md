# 次の実装計画

この文書は `user_memo.md`、`user_todo.md`、`agent_memo.md`、`agent_design.md`、`TODO.md` を整理し、
今後の実装順を一本化した計画である。

## 目的

- `STATUS` や生体データを調査しやすくする
- 生データをそのまま喋らせず、内部状態と因果を経由して人間味に変換する
- 因果グラフを初期値から持てる構造にする
- Graph DB と可視化を先に整え、後からセンサーや学習因果を足せる状態にする

## 現状整理

- `SOUL.md`
  Lv1-2 の固定性格と人格本文を持つ
- `BODY.md`
  Lv1-1 と Lv2 の固定身体データを持つ
- `STATUS.md`
  Lv3 の一部を持つ。表示層と暫定的な正本を兼ねている
- `.claude/memories/memory.db`
  長期記憶の正本
- `desires.json`
  自律行動のランタイム状態

不足しているのは次の4つである。

- 状態データの機械可読な正本
- 初期因果グラフ
- 因果を保存して辿る Graph DB
- 状態と因果を調査する可視化

## 優先順位

### 1. 状態データの整理と可視化基盤

最初にやるべきことは `STATUS.md` の役割整理である。
`STATUS.md` は表示層に寄せ、機械可読な正本を別に持つ。

やること:

- `STATUS.md` を人間向けダッシュボードと定義する
- 正本として `status.sqlite` を導入する
- 既存の読み書き経路を洗い出す
- `mood / energy / health / trust / satiation` の保存形式を固定する
- 未実装の vital を「センサー / 推定 / 手入力」のどれで扱うか決める
- 可視化用に時系列を取り出しやすい形にする

最初の成果物:

- status の現在値テーブル
- status の履歴テーブル
- センサー由来の観測テーブル
- `STATUS.md` への表示出力
- `mood / energy / satiation` の時系列グラフ

### 2. 初期因果グラフの整理

次に、自明な因果を先に定義する。
学習因果より先に、初期で決める因果を入れる。

因果は次の3層で管理する。

- Lv1 因果
  不変で普遍的な因果。本能や生物的制約
- Lv2 因果
  経験で固定化され、戻りにくい因果
- Lv3 因果
  文脈依存で、状態や相手によって変わる因果

最初に定義する対象:

- `sleep_short -> fatigue_up`
- `sleep_short -> mood_down`
- `blood_sugar_low -> irritability_up`
- `prolonged_hunger -> action_threshold_down`
- `brightness_morning -> arousal_up`
- `darkness_night -> reflect_bias_up`
- `cpu_temp_delta_high -> fatigue_up`
- `mem_free_low -> mental_margin_down`
- `successful_interaction -> mood_up`
- `successful_interaction -> social_openness_up`

この段階では、`sensor -> latent state -> action bias` の線を先に作る。
記憶との統合はその次にやる。

### 3. Graph DB の準備

因果の保存先として Kuzu を使う。
最初から memory 全体をグラフ化しない。まずは因果専用の小さな Graph DB として始める。

やること:

- Kuzu の最小検証を行う
- ノード型とエッジ型を定義する
- seed 因果を投入するスクリプトを作る
- 基本クエリを決める

最低限必要なクエリ:

- ある状態の原因を辿る
- ある状態の下流の行動傾向を辿る
- Lv1 / Lv2 / Lv3 の因果を分けて取得する
- 同じノードに入る複数因果を比較する

### 4. グラフと状態の可視化

状態グラフと因果グラフを別々に作らず、調査画面として統合する。

見たいもの:

- `mood / energy / satiation` の時系列
- 任意の時点で有効だった因果
- ノード間の因果チェーン
- Lv1 因果と学習因果の違い
- どのセンサーがどの内部状態に効いたか

最初の UI はシンプルでよい。
まずは「見えること」を優先する。

最初の画面:

- status timeline
- causal graph viewer
- timeline と graph の相互参照
- `Now / History / Logs` の3面構成

`ego-mcp` の dashboard は、この3分割がよくできている。
今の状態、履歴、ログを分けて見せる構成はそのまま参考にする。

### 5. 入力拡張

状態と因果の器ができてから、入力を増やす。

対象:

- Web 検索
- RSS 定期取得
- 追加の生体 proxy
- 空間と身体の統合
- 会話成功率や発話量の取り込み

ここは最後ではなく、基盤整備後の次段階とする。
入力だけ先に増やしても、因果に統合されない限り身体にはならない。

## 直近の実装順

### Phase 1

- 現在のデータ保存先と更新経路を一覧化する
- `status.sqlite` の最小 schema を決める
- `STATUS.md` を表示層に寄せる移行方針を書く
- `mood / energy / satiation` の時系列可視化を試作する

### Phase 2

- 初期因果の seed 一覧を作る
- 因果ノードを `sensor / latent / action / outcome` に分ける
- Lv1 / Lv2 / Lv3 の区分を仕様に固定する

### Phase 3

- Kuzu の PoC を作る
- seed 因果を投入する
- 原因追跡クエリと下流追跡クエリを作る

### Phase 4

- グラフ可視化を作る
- timeline と graph をつなぐ
- status と因果の調査画面にする

### Phase 5

- Web / RSS を入力として追加する
- 空間と身体の統合を設計する
- 学習因果と初期因果の接続を始める

## 別トラックで進める運用課題

これは重要だが、上の基盤整備とは分けて進める。

- satiation の減衰と摂取の再調整
- LHM 接続確認
- `heartbeat-daemon.sh` の Linux 常駐化
- heartbeat 行動選択フィルターの実装
- GitHub App 導入と運用周り
- memory のバックアップ

heartbeat 行動選択フィルターは、初期因果グラフが入ってから再設計する。
今やるとルールの寄せ集めで終わる。

## 調査メモ

後で見るもの:

- `ego-mcp`
  可視化は `Now / History / Logs` の分割が参考になる
- 語彙と知識範囲による人格制約
  人格の一貫性は、状態や因果だけでなく、知識範囲と語彙の制約でも補強できる
- Graph RAG の既存事例
  Graph は vector の代替ではなく補完と考える。まず因果 graph を作り、記憶との統合は後で行う

## この計画の中心

中心課題は次の4つである。

1. `STATUS` を見えるようにする
2. 自明な因果を先に埋める
3. Graph DB を導入する
4. 状態と因果を調査できる UI を作る

この順で進める。
