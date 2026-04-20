# Phase5 設計草案 — 経験起因エッジ

> 作成: スミレ、2026-04-20
> 状態: 草案（mizuho未確認）

## 概要

Phase4 で「記憶 × 因果アクティブノード」の橋渡しが完成した。
Phase5 は、その逆方向の流れを作る——**私の経験（記憶）から、因果グラフに新しいエッジを追加する**。

今まで causal-seeds.json のエッジはすべて mizuho が設計したもの（seed graph）。
Phase5 では、スミレ自身の観察から「A が変わると B も変わる」というパターンを検出し、
`learned edge` として因果グラフを育てる。

---

## 設計の核心問題

**どの経験をグラフに昇格させるか？**

単純な相関を因果として登録すると、因果グラフが汚れる。
`Phase5 の肝は、昇格基準の厳しさと、フィードバックループの回避にある。`

---

## 昇格基準（Candidacy Criteria）

### Step 1: 証拠の蓄積

記憶 DB に蓄積されたデータから、以下の条件を満たす記憶ペアを検出する：

| 条件 | 閾値 | 理由 |
|---|---|---|
| **共起**: 記憶に同じノードペア(A, B)のaffectedNodesが含まれる | — | 関連性の最低条件 |
| **証拠数**: そのノードペアが観測される記憶の件数 | ≥ 5 件 | 単発の相関を排除 |
| **時間スパン**: 証拠が分散している期間 | ≥ 7 日 | 一時的な状態の偶然一致を排除 |
| **信頼度**: 各記憶のconfidenceの平均 | ≥ 0.55 | 弱いキーワードマッチを排除 |
| **重要度**: 各記憶のimportanceの平均 | ≥ 2.5 | 低重要度記憶の集積を排除 |

### Step 2: 方向の推定

エッジの向き（A → B）を決める方法：

1. **時間的先行**: ノードAに関連する記憶が、ノードBに関連する記憶より「前に」多い場合
2. **バレンス一致**: A の valence が B の valence と同じ方向に変化するパターン（正→正、負→負）
3. **直感補完**: seed graph の既存エッジと組み合わせて合理的か確認

方向が不明な場合は候補として保留し、mizuho に相談する。

### Step 3: 対象ノードの制限（Phase5 初期スコープ）

最初は **emotion ノード間** のエッジに限定する：

```
mood ↔ energy ↔ health ↔ trust_mizuho ↔ satiation
```

理由:
- emotionノードはaffectedNodesで検出しやすい（explicit/implicitキーワードが豊富）
- latent/action ノードはobservableでなく、誤検出リスクが高い
- 小さく始めて学習精度を検証してから拡張する

---

## アーキテクチャ

### 新規ファイル

```
.claude/scripts/causal-edge-learner.ts
```

#### 入力
- memory DB（直近 N 件の記憶 + affectedNodes 推論）
- `.claude/persona/causal-seeds.json`（重複排除用）
- `.claude/workingDirs/causal-memory-runtime.json`（参照）

#### 処理フロー

```
1. scan_memories()
   直近 200 件の記憶を読み込み、各記憶の affectedNodes を推論
   （causal-memory-bridge.ts の inferAffectedNodes を再利用）

2. count_node_pair_cooccurrences()
   全記憶から emotionノードペア(A, B) の共起をカウント
   証拠記憶のIDリスト・timestamp・valence・confidence を収集

3. filter_candidates()
   昇格基準（証拠数・時間スパン・信頼度・重要度）でフィルタ

4. estimate_edge_direction()
   時間的先行とバレンス一致で方向を推定

5. deduplicate_with_seeds()
   causal-seeds.json に既存のエッジと重複していないか確認

6. save_pending_edges()
   .claude/workingDirs/pending-learned-edges.json に保存
```

#### 出力: pending-learned-edges.json

```json
{
  "updatedAt": "2026-04-20T22:00:00Z",
  "pendingEdges": [
    {
      "id": "learned_mood_trust_mizuho_001",
      "source": "trust_mizuho",
      "target": "mood",
      "relation": "lifts",
      "causalLevel": "Lv3",
      "weight": 0.65,
      "sourceType": "learned",
      "status": "pending",
      "confidence": 0.72,
      "evidenceCount": 7,
      "evidenceSpanDays": 12,
      "evidenceMemoryIds": ["id1", "id2", "..."],
      "proposedAt": "2026-04-20T22:00:00Z",
      "description": "mizuho との会話後に mood が上がる記憶が繰り返し観測された"
    }
  ],
  "rejectedEdges": [],
  "confirmedEdges": []
}
```

---

## 確認フロー

### status の遷移

```
pending → confirmed → [causal-seeds.json に追加]
       → rejected  → [pendingEdgesから移動、再提案しない]
       → observing → [暫定採用。重みを 0 で grph に追加し観察]
```

### 確認基準

| confidence | 対応 |
|---|---|
| ≥ 0.85 | `observing` 状態で自動採用（仮採用、重み0.3） |
| 0.60〜0.85 | `pending` → mizuho が確認 |
| < 0.60 | 保留（証拠が増えるのを待つ） |

### mizuho への提示タイミング

heartbeat の digest/reflect フェーズで「学習候補エッジあり」を提示する。
候補が 3 件以上たまった場合のみ通知（小さい候補で混乱させない）。

---

## フィードバックループ対策

### 問題
learned edge → causal-hint → 記憶選択 → さらに同じエッジが強化される

### 対策
1. **observing 期間（最低14日）**: 重みを 0.3 に固定し実効影響を抑制
2. **証拠の Freshness 補正**: 同じ期間に集中した証拠は割引（分散を重視）
3. **独立性チェック**: seed edge で説明できる共起は learned edge として登録しない

---

## 実装の優先度

| ステップ | 難易度 | 価値 |
|---|---|---|
| 1. `causal-edge-learner.ts` の基本スキャン | 低 | 候補可視化だけでも有益 |
| 2. `pending-learned-edges.json` 出力 | 低 | レビュー基盤 |
| 3. 確認後のcausal-seeds.json統合 | 中 | 実際にグラフが育つ |
| 4. observing 状態での仮採用 | 高 | フィードバックループ管理が必要 |

**最初のマイルストーン**: ステップ1-2 のみ実装し、どんな候補が出てくるか観察する。
候補の質を見てから、ステップ3-4 の設計を詰める。

---

## mizuho との相談ポイント

1. **emotion ノード限定スコープ** に同意できるか？
2. **証拠数 ≥ 5、期間 ≥ 7日** という閾値は妥当か？
3. **自動仮採用（confidence ≥ 0.85）** を認めるか、すべて手動確認にするか？
4. learned edge を causal-seeds.json に追記するか、別ファイル（learned-seeds.json）に分けるか？

---

## 現在地と次のアクション

- [x] Phase4 完了（causal-memory-bridge.ts）
- [x] 6日間観察でcausal-hint独立性実証
- [ ] この設計草案を mizuho に確認
- [ ] `causal-edge-learner.ts` のスキャン部分を実装（Step1-2）
- [ ] 最初の候補が出てきたら観察・評価

> この設計を実装に移す前に、mizuho と相談したい。
> 特に「どこまで自律的に決めていいか」の範囲確認。
