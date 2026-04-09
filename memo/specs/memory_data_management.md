# 既存の記憶データ管理仕様

## 概要

wardrobe の記憶システムは、現在 **`memory-mcp` を中心とした SQLite ベース** で動いている。

中核は `.claude/memories/memory.db` で、そこに記憶本文・埋め込み・連想・因果リンク・エピソードなどを保持する。  
`FLASH.md` や `memo/discussionMemo/` は二次的なビューであり、**source of truth は SQLite** である。

---

## データの置き場所

### 1. 主記憶

- パス: `.claude/memories/memory.db`
- 役割: 記憶の正本
- 形式: SQLite
- モード: WAL

`memory-mcp` は `CLAUDE_PROJECT_DIR/.claude/memories/memory.db` を優先し、見つからない場合のみ `~/.claude/memories/memory.db` にフォールバックする。

### 2. 補助的な記憶ビュー

- `FLASH.md`
  - キーワード索引
  - 本文の完全保存先ではない
  - 想起の導線
- `memo/discussionMemo/YYYYMMDD.md`
  - 当日の記憶要約
  - 日次の人間可読サマリ
- `desires.json`
  - 記憶そのものではないが、satiation 連動などで自律行動に影響する内部状態

---

## 現行アーキテクチャ

記憶データの流れはおおむね以下。

1. `memory-mcp` に `remember` / `save_visual_memory` / `save_audio_memory` などで保存
2. 本文は `memories` テーブルへ
3. 埋め込みは `embeddings` テーブルへ
4. 連想や因果は `coactivation` と `memories.links` に保存
5. エピソードは `episodes` テーブルに保存
6. 想起時は semantic search / BM25 / association / causal chain を組み合わせて参照

---

## 中核スキーマ

### `memories`

主テーブル。1件の記憶を1行で持つ。

主なカラム:

- `id`
- `content`
- `normalized_content`
- `timestamp`
- `emotion`
- `importance`
- `category`
- `access_count`
- `last_accessed`
- `linked_ids`
- `episode_id`
- `sensory_data`
- `camera_position`
- `tags`
- `links`
- `novelty_score`
- `prediction_error`
- `activation_count`
- `last_activated`
- `reading`
- `freshness`

### `embeddings`

意味検索用ベクトル。

- `memory_id`
- `vector`

形式は `numpy float32` を BLOB で保存している。

### `coactivation`

記憶間の共活性化重み。連想想起や related link の材料になる。

- `source_id`
- `target_id`
- `weight`

これは JSON ではなく独立テーブルなので、軽いグラフとして扱える。

### `episodes`

複数の記憶を束ねた体験単位。

- `id`
- `title`
- `start_time`
- `end_time`
- `memory_ids`
- `participants`
- `location_context`
- `summary`
- `emotion`
- `importance`

### `verb_chains` / `verb_chain_embeddings`

「見る→気になる→調べる」のような構造記憶。

- 行為列そのものは `verb_chains`
- 構造検索用ベクトルは `verb_chain_embeddings`

### composite 系テーブル

統合・圧縮・抽象化のための派生構造。

- `composite_members`
- `composite_embeddings`
- `composite_axes`
- `boundary_layers`
- `template_biases`
- `composite_intersections`

これは通常の remember/recall の直接入力ではなく、consolidation 系の内部構造に近い。

### `daily_digest`

日付単位のサマリ。

- `date`
- `memory_count`
- `summary`
- `categories`
- `emotions`
- `avg_importance`
- `memory_ids`
- `updated_at`

---

## 記憶の型

現行システムでは、記憶は大きく次のレイヤで表現される。

### 1. 基本文脈記憶

- 内容
- 感情
- 重要度
- カテゴリ
- タイムスタンプ

### 2. 感覚つき記憶

`sensory_data` と `camera_position` を持つ。

- 視覚記憶
  - 画像パス
  - 低解像度 `image_data` の内包コピー
  - カメラ角度
- 音声記憶
  - 音声ファイルパス
  - transcript

重要なのは、

- 視覚記憶は DB 内に縮小コピーを持てる
- 音声記憶は元ファイル参照が主である

という非対称性があること。

### 3. エピソード記憶

複数の記憶をひとまとまりの体験として扱う。

### 4. 因果・関連記憶

記憶間リンクを `MemoryLink` として持つ。

リンク種別:

- `similar`
- `caused_by`
- `leads_to`
- `related`

### 5. 連想重み

明示リンクとは別に、`coactivation.weight` を使って「一緒に活性化しやすい記憶」を保持する。

---

## グラフ構造の扱い

現行実装は **Graph DB ではなく、SQLite 上の軽量グラフ** である。

### 明示リンク

因果・関連リンクは `memories.links` に JSON で保持される。

- 書き込み: `link_memories`
- 走査: `get_causal_chain`

これは DB のグラフクエリエンジンではなく、アプリ側でリンクを辿る方式。

### 暗黙リンク

共起・再活性化は `coactivation` テーブルに保持される。

こちらは「重み付きエッジ」に近い。

### 現在の限界

- 多段ホップ推論は弱い
- 状態ノードや人物ノードを統一的に扱っていない
- 因果グラフは記憶間リンクに限定されている
- Neo4j のような Graph RAG ではない

---

## 既存のデータ管理方針

### 1. Source of truth は SQLite

Markdown メモは補助であり、正本ではない。

### 2. 人間可読ビューを別に持つ

- `FLASH.md` は検索導線
- `discussionMemo` は日次の読み物

### 3. 埋め込みは DB 内に内包

外部ベクトル DB を使わず、SQLite + numpy で閉じている。

### 4. 移植性を重視

単一 SQLite ファイルでバックアップ・コピー・移植しやすい設計。

ただし WAL モードのため、コピー時は `export_sqlite_snapshot.py` による snapshot が推奨。

---

## 現在ある移行・保守スクリプト

### インポート / 移行

- `migrate_chroma_to_sqlite.py`
  - 旧 ChromaDB から移行
- `migrate_postgres_to_sqlite.py`
  - PostgreSQL から移行
- `merge_memories.py`
  - 旧 Chroma ベース記憶のマージ

### ベクトル保守

- `migrate_embeddings_sqlite.py`
  - 埋め込み次元やモデル変更時の再計算

### エクスポート

- `export_sqlite_snapshot.py`
  - 移植用の一貫した SQLite snapshot を生成

---

## 現行の長所

- 単一ファイルで扱いやすい
- Python 標準ライブラリ + numpy で完結しやすい
- Graph DB を立てなくても最低限の関連・因果を持てる
- バックアップや移植が比較的容易
- Chroma / PostgreSQL からの移行経路がすでにある

---

## 現行の弱点

### 1. グラフが分散表現

リンクは `links JSON`、共起は `coactivation`、索引は `FLASH.md`、要約は `discussionMemo` と分散している。

### 2. Markdown 補助資産との整合性が弱い

SQLite が更新されても、`FLASH.md` や `discussionMemo` は自動で完全同期されるわけではない。

### 3. 因果グラフが記憶中心

人物、状態、欲望、STATUS、環境要因を同じグラフで扱えていない。

### 4. sensory data の外部依存

特に音声は `file_path` 参照なので、DB 単体では完全移植にならない場合がある。

### 5. SQL 上の軽量グラフ止まり

「3ホップ先の概念」「状態遷移」「一般知識と個人史の混成推論」にはまだ弱い。

---

## 今後の拡張候補

### A. 現行 SQLite を維持して強化

- `nodes` / `edges` 的な正規化テーブルを追加
- recursive CTE で因果探索を強化
- STATUS / desires / users も graph に寄せる

### B. PostgreSQL へ昇格

- 埋め込みは `pgvector`
- graph は edge table で表現
- 将来 SaaS 化しやすい

### C. Graph DB を追加

SQLite は本文と埋め込みの正本として残し、

- Neo4j
- Kuzu
- DuckDB + graph 拡張

などを別レイヤで併用する案。

ただし現状の wardrobe はここまでは行っておらず、**いまある実装は SQLite 中心の軽量グラフ記憶** である。

---

## 要点まとめ

- 既存の記憶データ管理の中心は `.claude/memories/memory.db`
- そこに本文・埋め込み・連想・因果・エピソード・日次要約まで入っている
- `FLASH.md` や `memo/discussionMemo/` は補助的ビュー
- 因果グラフはあるが、Graph DB ではなく SQLite 上の軽量表現
- 移植やバックアップのしやすさは高い
- その代わり、複雑な Graph RAG や状態横断推論にはまだ弱い
