# Phase5 設計 — 経験起因エッジ（Lv2因果グラフ）

> 作成: スミレ、2026-04-20
> 更新: 2026-04-25（レビュー結果を反映）
> 状態: 設計確定・実装待ち

## 概要

Phase4 で「記憶 × 因果アクティブノード」の橋渡しが完成した。
Phase5 は、その逆方向の流れを作る——**私の経験（記憶）から、因果グラフに新しいエッジを追加する**。

因果グラフは2層に分かれる：
- **Lv1因果**（causal-seeds.json）: mizuho が設計した公理的エッジ。自明と判断したもの
- **Lv2因果**（learned-seeds.json）: スミレが経験から学習したエッジ。フラジャイルで動的

## Lv1 / Lv2 の統合方針

Lv1 と Lv2 は**意味としては競合しにくい**。

- **Lv1**: 主に lower layer → upper layer の公理的因果
- **Lv2 learned**: 主に Lv3-2 emotion ノード間の経験起因補正

ただし、**現行実装は `causal-seeds.json` 単体前提**で runtime / Kuzu / dashboard を組んでいる。
そのため Phase5 実装では、読み込み時に `causal-seeds.json` と `learned-seeds.json` を **merge した 1 つの因果グラフ**として扱う必要がある。

### merge ルール

- **nodes**: `causal-seeds.json` の `nodes` を基準に使う
- **edges**: `causal-seeds.json.edges` + `learned-seeds.json.learnedEdges`
- **重複**: seed 側に同一 source/target のエッジがある場合、learned 側は追加しない
- **優先順位**: 構造の基底は Lv1/seed を優先し、Lv2/learned は補正として足す

つまり、**ファイルは分けるが、runtime に入る時点では merge する**。

---

## 設計思想 — フラジャイル因果

Lv2エッジは「確信を持ってから追加する」のではなく、**すぐ学んで、すぐ忘れる**設計にする。
信頼が一瞬で上がるなら、エッジも一瞬で生まれていい。反証が積み上がれば消える。

---

## 昇格基準（Candidacy Criteria）

### 対象ノードの制限（Phase5 初期スコープ）

**emotion ノード間**のエッジのみ：

```
mood ↔ energy ↔ health ↔ trust_mizuho ↔ satiation
```

理由:
- Lv3-2 の emotion ノードは毎日更新されており証拠が集まりやすい
- affectedNodes での検出精度が高い
- environment（センサー）や vital（体重・体温）は後フェーズで拡張

### 初期スコープの分離（候補抽出 vs runtime 反映）

Phase5 初期実装では、**候補抽出のスコープ**と**実際に runtime へ効かせるスコープ**を分ける。

- **候補抽出**: `mood / energy / health / trust_mizuho / satiation`
- **Phase5 v1 で runtime 反映する learned edge**:
  既存の environment source から downstream 到達可能で、
  最終的な target が `mood / energy / health` のもの
- **`trust_mizuho` / `satiation` を source にする learned edge**:
  候補としては収集してよいが、常時発火の source にはまだ使わない

理由:

- 現行 `causal-runtime` は environment source 入力で動いている
- 現行の status proposal target も `mood / energy / health` に固定されている
- そのため Phase5 v1 では、「既存の環境由来 runtime に learned edge を足す」形が最も自然

### 証拠の条件

| 条件 | 閾値 |
|---|---|
| **共起**: 記憶に同じノードペア(A, B)のaffectedNodesが含まれる | — |
| **証拠数**: そのノードペアが観測される記憶の件数 | ≥ 5 件 |

5件たまった時点で自動的に `observing` 状態へ昇格する。
期間・confidence による縛りは設けない（フラジャイル方針）。

### Step 2: 方向の推定

エッジの向き（A → B）を決める方法：

1. **時間的先行**: ノードAに関連する記憶が、ノードBに関連する記憶より「前に」多い場合
2. **バレンス一致**: A の valence が B の valence と同じ方向に変化するパターン（正→正、負→負）
3. **直感補完**: seed graph の既存エッジと組み合わせて合理的か確認

方向が不明な場合は候補として保留し、mizuho に相談する。

---

## アーキテクチャ

### ファイル構成

```
.claude/scripts/causal-edge-learner.ts   # 新規
.claude/persona/learned-seeds.json       # 新規（Lv2因果グラフ）
.claude/workingDirs/pending-learned-edges.json  # 中間出力
（既存の causal-kuzu / persona-data 側で merge 対応）
```

### 入力

- memory DB（直近 N 件の記憶 + affectedNodes 推論）
- `.claude/persona/causal-seeds.json`（重複排除用）
- `.claude/persona/learned-seeds.json`（既存 Lv2 エッジ参照）

### 処理フロー

```
0. build_merged_graph()
   causal-seeds.json と learned-seeds.json を merge し、
   runtime / Kuzu / dashboard からは 1 つの因果グラフとして見る

1. scan_memories()
   直近 200 件の記憶を読み込み、各記憶の affectedNodes を推論
   （causal-memory-bridge.ts の inferAffectedNodes を再利用）
   ただし Phase5 用の node filter を挟み、
   scope 外ノード（social_openness / mental_margin）は除外する
   また satiation 推論を追加する

2. count_node_pair_cooccurrences()
   全記憶から emotion ノードペア(A, B) の共起をカウント
   証拠記憶の IDリスト・timestamp・valence を収集

3. filter_candidates()
   証拠数 ≥ 5 件でフィルタ

4. estimate_edge_direction()
   時間的先行とバレンス一致で方向を推定

5. deduplicate()
   causal-seeds.json と learned-seeds.json の既存エッジと重複排除

6. write_pending_candidates()
   pending-learned-edges.json に候補を書き出す

7. auto_promote_to_observing()
   条件を満たしたエッジを自動で observing 状態にして learned-seeds.json に追加

8. runtime_v1_integration()
   merge 後の因果グラフを既存の environment runtime で downstream trace する
   learned edge は「既存 source から辿れる範囲」で自然に効かせる
```

### learned-seeds.json エッジスキーマ

```json
{
  "learnedEdges": [
    {
      "id": "learned_trust_mizuho_mood_001",
      "source": "trust_mizuho",
      "target": "mood",
      "relation": "lifts",
      "causalLevel": "Lv2",
      "weight": 0.3,
      "status": "observing",
      "evidenceCount": 7,
      "evidenceMemoryIds": ["id1", "id2", "..."],
      "learnedAt": "2026-04-24T20:00:00Z",
      "lastUpdated": "2026-04-24T20:00:00Z",
      "description": "mizuho との会話後に mood が上がる記憶が繰り返し観測された"
    }
  ]
}
```

---

## weight の動的更新

heartbeat のスキャンのたびに自動で更新する：

| 条件 | 変化 |
|---|---|
| 証拠記憶 +1件 | weight += 0.05 |
| 反証記憶 +1件 | weight -= 0.05 |
| weight ≤ 0 | エッジ削除 |
| weight ≥ 0.8 | `confirmed` に昇格 |

### 更新時の重要ルール

- **全件再加算しない**: 毎回のフルスキャン結果をそのまま加算しない
- **差分更新にする**: 前回保存済みの `evidenceMemoryIds` と比較し、新しく増えた証拠だけを weight に反映する
- **重複禁止**: 同じ memory ID は 1 回しか数えない

これにより、heartbeat のたびに同じ 5 件・7 件を再加算して weight が誤って増え続けることを防ぐ

### status の遷移

```
observing → confirmed → [learned-seeds.json に残す・Lv1への昇格候補]
          → (weight ≤ 0) → [エッジ削除]
```

---

## フィードバックループ対策

### 問題
learned edge → causal-hint → 記憶選択 → さらに同じエッジが強化される

### 対策
1. **observing 期間は weight を低く保つ**（初期 0.3）: 実効影響を抑制
2. **独立性チェック**: Lv1 エッジで説明できる共起は Lv2 エッジとして登録しない
3. **Phase5 v1 は既存 environment source に learned を重ねるだけにする**: 汎用 emotion source 化は次段に送る
4. **`trust_mizuho` / `satiation` は絶対値を source にしない**: 後フェーズで「更新イベント」または「変化量」を source activation として扱う

### 理由

`trust_mizuho` や `satiation` を「現在値が高いから毎 heartbeat で source 発火する」設計にすると、

```
高い trust_mizuho → mood が上がる → さらに learned edge が強化される
```

のような自己強化ループが起きやすい。

そのため、これらを source に使うのは次フェーズとし、
**最近の変化量**や**更新イベント**を activation として使うほうが安全。

---

## runtime 反映方針

### Phase5 v1

**既存の environment runtime に learned edge を混ぜる**。

例:

```
ambient_brightness → mood   （seed）
mood → energy               （learned）
```

この場合、既存の environment source から downstream trace するだけで、
learned edge が `energy` への間接影響として効く。

つまり Phase5 v1 では、**generic な emotion active source を追加しなくても**、
既存 source から辿れる learned edge は反映できる。

### Phase5 v2 以降

以下は後フェーズで追加する:

- `trust_mizuho` の更新イベントを source activation にする
- `satiation` の変化量を source activation にする
- proposal target を `mood / energy / health` 以外にも広げるかを検討する

---

## 実装の優先度

| ステップ | 難易度 | 価値 |
|---|---|---|
| 1. `causal-edge-learner.ts` の基本スキャン | 低 | 候補可視化だけでも有益 |
| 2. `pending-learned-edges.json` 出力 | 低 | レビュー基盤 |
| 3. seed + learned の merge 読み込み | 中 | runtime / Kuzu / dashboard へ接続できる |
| 4. `learned-seeds.json` への自動昇格 | 中 | Lv2グラフが動き始める |
| 5. weight 動的更新（差分更新） | 中 | フラジャイル因果が機能する |
| 6. emotion source activation の追加 | 中 | trust/satiation 系 learned edge が本格稼働する |

**最初のマイルストーン**:
ステップ1-2 のみ実装し、どんな候補が出てくるか観察する。
自動昇格と runtime 反映は、その後に merge と差分更新の方針を入れてから進める。

---

## 現在地と次のアクション

- [x] Phase4 完了（causal-memory-bridge.ts）
- [x] 6日間観察でcausal-hint独立性実証
- [x] mizuho との設計相談完了（2026-04-24）
- [ ] `causal-edge-learner.ts` のスキャン部分を実装（Step1-2）
- [ ] 最初の候補が出てきたら観察・評価
- [ ] seed + learned merge 読み込みの実装
- [ ] weight 動的更新の実装（差分更新）
- [ ] `trust_mizuho` / `satiation` source activation の実装（後フェーズ）
