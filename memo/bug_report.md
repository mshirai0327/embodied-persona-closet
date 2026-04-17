# autonomous-action token 消費増加 調査メモ

## 概要

- 調査日: 2026-04-11
- 対象: `cron` 実行の `autonomous-action.sh`
- 症状: 最近、Claude の token 消費が増えた体感がある
- 結論: 主因は `memory` の総件数増加そのものより、`--resume` による長寿命セッション継続と、最近追加されたプロンプト注入量の増加の可能性が高い

---

## 結論

### 1. `memory` の総件数増加は主因ではなさそう

`recall-lite.ts` は記憶 DB 全件をそのままプロンプトに流していない。

- 直近重要記憶: 最大 3 件
- 高頻度アクセス記憶: 最大 3 件
- 未完了タスク: 最大 3 件
- 各本文は 80 文字で打ち切り

つまり、記憶件数が 10 件から 100 件になったとしても、`recall-lite` の注入量は線形には増えない。

2026-04-11 時点の DB 実測:

- 記憶件数: 46
- 本文平均長: 270.8 文字
- 本文最大長: 414 文字

総件数より、「最近の記憶本文が長いこと」のほうが効きやすい。

### 2. いちばん怪しいのは長寿命セッション

`autonomous-action.sh` は heartbeat ごとに新規会話を始めず、`heartbeat-session-id` を使って `claude -p --resume` している。

そのため、heartbeat のたびに会話履歴が伸び、input token が増え続ける構造になっている。

ログ確認では、同じ session id が少なくとも以下の期間で継続していた。

- 2026-04-09 22:00
- 2026-04-10 00:00
- 2026-04-10 日中
- 2026-04-11 20:00

確認できた同一 session id の resume 回数は 16 回。

これは「1 回あたりの prompt が少し増えた」よりも、消費増に強く効く可能性が高い。

### 3. 最近、heartbeat に乗る注入テキストが増えている

`autonomous-action.sh` は最近、以下を毎回組み立てるようになっている。

- `interoception.ts`
- `recall-lite.ts`
- `status-hint.ts`
- desire 系テキスト

実測値:

- `recall-lite.ts` 出力: 約 1010 bytes
- `status-hint.ts` 出力: 約 242 bytes
- `interoception.ts` 出力: 約 328 bytes
- `--dry-run` 全体 prompt: 約 4285 bytes

`recall-lite` 単体より、複数の補助ヒントが積み重なっている点が重要。

### 4. 通常回 prompt 自体が memory を毎回読みに行く

`prompts.toml` の通常回は、毎回 `list_recent_memories` を呼ぶ指示になっている。

`list_recent_memories` はデフォルトで最大 10 件の記憶本文を返す。
ここは `recall-lite` と違って 80 文字打ち切りではないため、最近の長い記憶が毎回そのまま tool 出力として会話に積まれる可能性がある。

つまり、

- 記憶の総件数増加
- ではなく
- 最近保存される記憶本文の長文化

のほうが token 消費に直結しやすい。

### 5. 週末は実行回数そのものが増える

`schedule.conf` では `HOLIDAY_WEEKDAYS="0,6"` になっており、土日は holiday 扱い。

holiday は 7-24 時がアクティブ帯で、20 分ごとに毎回実行される。
そのため、平日と比較すると token 消費が増えやすい。

---

## 根拠

### A. セッション継続

`autonomous-action.sh` の normal mode:

- `SESSION_FILE="$SCRIPT_DIR/heartbeat-session-id"`
- 既存 session があれば `claude -p --resume "$SESSION_ID"` を実行

この設計により、heartbeat は独立タスクではなく「長い 1 会話」になっている。

### B. prompt への注入

`autonomous-action.sh` では毎回以下を組み立てる。

- `@SOUL.md`
- `@BOOT_SHUTDOWN.md`
- `@TODO.md`
- `@ROUTINES.md`
- `interoception`
- `recall-lite`
- `status-hint`

参照ファイルの現在サイズ:

- `SOUL.md`: 2679 bytes
- `BOOT_SHUTDOWN.md`: 3678 bytes
- `TODO.md`: 2778 bytes
- `ROUTINES.md`: 1684 bytes

合計 10819 bytes。

CLI 側でこれらが毎回読まれる前提なら、memory よりこちらの固定コストも大きい。

### C. `recall-lite` の上限

`recall-lite.ts` は以下で打ち止めになっている。

- 直近重要記憶 `LIMIT 3`
- 高頻度アクセス記憶 `LIMIT 3`
- 未完了タスク `LIMIT 3`
- 各記憶は 80 文字まで

したがって、`memory.db` 件数そのものが増えただけで prompt が無限に伸びる構造ではない。

### D. 最近の変更履歴

autonomous 周辺には直近で以下の変更が入っている。

- 2026-04-07: `STATUS.md` 系実装
- 2026-04-08: `interoception` / `environment-tick` / `satiation`
- 2026-04-09: desire 連動、memory DB 周辺修正
- 2026-04-10: `STATUS` 更新基盤追加

「最近増えた」という体感は、これらの注入追加時期と整合する。

---

## 原因候補の優先順位

### 優先度 高

- `--resume` による長寿命セッション継続

### 優先度 中

- `interoception`、`status-hint`、`desire`、`recall-lite` の積み上げ
- 通常回での `list_recent_memories` 実行
- `SOUL.md` / `BOOT_SHUTDOWN.md` / `TODO.md` / `ROUTINES.md` の毎回参照

### 優先度 低

- `memory.db` 総件数の増加そのもの

---

## 現時点の判断

「memory が増えたせいか？」への答えは、

- 完全に無関係ではない
- ただし主因っぽくはない

が妥当。

より正確には、

- memory の総件数ではなく
- 最近の長い記憶本文が tool 出力で繰り返し使われること
- そして何より同じ session を何度も `resume` していること

が効いている可能性が高い。

---

## 改善候補

### 1. heartbeat session を定期的に切る

最有力。

候補:

- 日次で新規 session を作る
- 連続実行回数が一定を超えたら新規 session に切り替える
- weekend / holiday は session rotation を短くする

### 2. `list_recent_memories` の量を減らす

候補:

- 10 件 → 3 件
- 本文全文ではなく短縮版を返す
- `importance >= 4` のみ対象にする

### 3. `recall-lite` をさらに圧縮する

すでに上限付きだが、さらに削れる。

候補:

- 各項目 80 文字 → 40〜60 文字
- `3 + 3 + 3` → `2 + 2 + 2`
- 似た記憶をまとめて 1 行化する

### 4. prompt に毎回含める参照ファイルを見直す

候補:

- `BOOT_SHUTDOWN.md` は朝の初回だけ
- `ROUTINES.md` は routine 回だけ
- `TODO.md` は通常回だけ

### 5. usage をログに残す

現状のログには token usage がほぼ残っていない。
原因切り分けのためには、heartbeat ごとの usage を保存したほうがよい。

---

## 要約

- memory 件数増加だけが原因とは考えにくい
- 主因候補は `--resume` による会話履歴の肥大化
- 次点で、最近追加された `STATUS` / `interoception` / `recall-lite` 系の注入増
- さらに通常回の `list_recent_memories` が、長い記憶本文を毎回会話へ持ち込む可能性がある
- まずは session rotation の導入が最も効果的と思われる
