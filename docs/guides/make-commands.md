# Make コマンドガイド

> persona 周りの操作を `bun run` ではなく `make` でまとめて実行するためのガイド。

---

## 目的

このリポジトリでは `.claude/scripts/` 配下の Bun スクリプトをよく使う。
毎回長いコマンドを打たずに済むよう、よく使う操作を `Makefile` にまとめている。

基本的には、次のどちらでも同じことができる。

```bash
bun .claude/scripts/persona-dashboard.ts
make persona-dashboard
```

---

## 前提

必要なもの:

- `make`
- `bun`
- `node`

`Kuzu` は Node helper 経由で読むので、Bun だけでなく `node` も必要。

---

## 使えるコマンド

一覧を見る:

```bash
make help
```

主なコマンド:

| コマンド | 役割 |
|---|---|
| `make persona-sync` | Markdown から SQLite / Kuzu を同期する |
| `make persona-dashboard` | persona ダッシュボードを起動する |
| `make persona-causal-sync` | `causal-seeds.json` を Kuzu に同期する |
| `make persona-causal-summary` | Kuzu graph の件数サマリを見る |
| `make persona-causal-snapshot` | Kuzu の全 nodes / edges を JSON で見る |
| `make persona-causal-node KEY=energy` | 指定 node の流入・流出因果を見る |
| `make persona-causal-trace KEY=energy DIRECTION=both DEPTH=3` | 指定 node の upstream / downstream を辿る |
| `make persona-causal-candidates` | learned edge 候補を JSON で表示する（ファイル更新なし） |
| `make persona-test` | persona 関連テストをまとめて実行する |

---

## よく使う例

### 1. 状態と因果を同期する

```bash
make persona-sync
```

やっていること:

- `SOUL.md`
- `BODY.md`
- `STATUS.md`
- `ENVIRONMENT.md`

を読み、`persona-status.sqlite` に同期する。
その後、seed 因果を `persona-causal.kuzu` に同期する。

### 2. ダッシュボードを起動する

```bash
make persona-dashboard
```

ブラウザで開く URL は、起動ログに表示される。

### 3. Kuzu の中身をざっと見る

```bash
make persona-causal-summary
```

見られるもの:

- node 数
- edge 数
- kind ごとの件数
- dataLevel ごとの件数
- causalLevel ごとの件数

### 4. ある node の周辺因果だけ見る

```bash
make persona-causal-node KEY=energy
make persona-causal-node KEY=trust_mizuho
```

見られるもの:

- node 本体
- incoming edges
- outgoing edges

### 5. upstream / downstream を辿る

```bash
make persona-causal-trace KEY=energy DIRECTION=both DEPTH=2
make persona-causal-trace KEY=mood DIRECTION=upstream DEPTH=3
make persona-causal-trace KEY=trust_mizuho DIRECTION=downstream DEPTH=2
```

指定できる変数:

| 変数 | 既定値 | 説明 |
|---|---|---|
| `KEY` | `energy` | 起点にする node id |
| `DIRECTION` | `both` | `upstream / downstream / both` |
| `DEPTH` | `3` | 再帰の深さ |

### 6. テストをまとめて回す

```bash
make persona-test
```

現時点では次のテストをまとめて実行する。

- `causal-kuzu.test.ts`
- `causal-graph.test.ts`
- `persona-data.test.ts`
- `environment-store.test.ts`
- `environment-tick.test.ts`

---

## `bun run` との関係

`package.json` にも script は残している。
なので、好みでどちらを使ってもよい。

例:

```bash
bun run persona:causal-sync
bun run persona:causal-inspect -- trace energy --direction=both --depth=2
```

ただし日常運用では、変数を付けやすいので `make` のほうが使いやすい。

---

## Kuzu lock について

Kuzu は同時アクセス時に lock を取る。
そのため、dashboard や別プロセスが掴んでいると書き込み系は待てない。

現行実装では:

- `persona-causal-sync` のような書き込み系は lock 中だと失敗する
- `persona-causal-summary` / `node` / `trace` のような読み取り系は temp copy fallback で読める

つまり、確認系コマンドは dashboard 起動中でも使えるようにしてある。

---

## 実装ファイル

関連ファイル:

- [Makefile](/home/mizuho/develop/embodied-reflecta/Makefile:1)
- [causal-kuzu-inspect.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/causal-kuzu-inspect.ts:1)
- [causal-kuzu.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/causal-kuzu.ts:1)
- [causal-kuzu-node.mjs](/home/mizuho/develop/embodied-reflecta/.claude/scripts/causal-kuzu-node.mjs:1)
