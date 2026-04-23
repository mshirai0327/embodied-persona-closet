# cron の時間変更方針を決めるための調査メモ

- 調査日: 2026-04-23
- 目的: Claude の token 使用量の時間分布を把握し、どの時間帯・どの処理が重いかを見たうえで、cron 時間変更や重い処理の見直し方針を決める

## 結論

- いまの段階では、cron の時間変更を先に決めるより、まず計測を成立させるほうが先。
- 現在の実 `crontab` は 20 分おきではなく、2 時間おき。
- heartbeat ごとの token 使用量は、現状ほぼ取れていない。
- 以前の「`--resume` で会話が肥大化しているかも」という仮説は、最近のログを見る限り今は主因とは言い切れない。
- 逆に、`朝の再構成` が最近の active run で毎回入っている可能性が高く、観測を歪めている。
- `schedule.conf` の値の一部は、今は runtime で使われていない。

## 分布

```
active runs by hour (recent logs)

00  |
02  |
04  |
06  |
08  |
10  |#
12  |##
14  |
16  |#
18  |##
20  |###
22  |##
```

```
avg duration by hour (seconds, recent logs)

10  |############## 170s
12  |##################### 249s
16  |######################################## 497s
18  |################### 234s
20  |############## 177s
22  |################# 218s

```

## どう調べたか

### 1. スケジュールの実態確認

以下を確認した。

- `crontab -l`
- `schedule.conf`
- `autonomous-action.sh`

確認ポイント:

- 実際の cron 起動間隔
- 平日 / 休日 / 休暇の分岐
- 昼間 / 深夜の確率スキップ
- 22-23 時台の追加処理

### 2. 実行ログの確認

以下を対象に、最近のログを grep した。

- `.claude/logs/*.log`

見たもの:

- `自律行動開始`
- `自律行動終了`
- `新規セッション作成`
- `resume`
- `昼間スキップ`
- `深夜スキップ`
- `朝の再構成`
- `BEDTIME_HEALTH`
- `DISCUSSION_MEMO`

そのうえで、簡単なワンライナーで以下を集計した。

- 時間帯ごとの `active / skip`
- active run の所要時間
- `通常回 / ルーチン回`
- `朝の再構成` の有無

### 3. token 計測経路の確認

以下を確認した。

- `.claude/scripts/system-health.ts`
- `.claude/workingDirs/system-health-history.json`
- `ccusage --help`

見たかったこと:

- 既存で日次 token 記録が取れているか
- heartbeat 単位の token 記録があるか
- `ccusage` が実行できる状態か

### 4. セッション継続とサブエージェント可視性の確認

以下を確認した。

- `heartbeat-session-id` の有無
- ログ中の `resume` 記録
- ログ中に subagent 使用が追える記録があるか

## 調査に使ったコマンド例

```bash
crontab -l

rg -n "DAYTIME_CHANCE|NIGHT_CHANCE|ROUTINE_CHANCE|VACATION_ROUTINE_CHANCE" schedule.conf autonomous-action.sh

rg -n "自律行動開始|自律行動終了|新規セッション作成|スキップ|resume失敗|Prompt is too long|No conversation found" .claude/logs/*.log

rg -n "collectTokens|ccusage|system-health-history|tokens" .claude/scripts/system-health.ts .claude/workingDirs/system-health-history.json

ccusage --help

ls -la heartbeat-session-id .claude/workingDirs/last-session-date.txt workingDirs/last-session-date.txt 2>/dev/null
```

## 観測結果

### 1. 実際の cron は 2 時間おき

実 `crontab` は以下だった。

```cron
0 */2 * * * /home/mizuho/develop/embodied-reflecta/autonomous-action.sh
```

つまり、現在の実運用は「20 分おき」ではなく「2 時間おき」。

`schedule.conf` や `autonomous-action.sh` のコメントにはまだ 20 分前提の説明が残っているが、少なくとも現在の `crontab` はそうなっていない。

### 2. 現在の実効スケジュール

`autonomous-action.sh` のロジックをそのまま読むと、平日は次のようになっている。

- `12`, `18`, `20`, `22` 時台: 常時実行
- `08`, `10`, `14`, `16` 時台: 50% で実行
- `00`, `02`, `04`, `06` 時台: 10% で実行

休日は `7 時以降はすべて active` という設計だが、実 cron が 2 時間おきなので、実際には「20 分おきで密に動く」状態にはなっていない。

### 3. `schedule.conf` の値の一部は死んでいる

設定ファイルには以下がある。

- `DAYTIME_CHANCE=50`
- `NIGHT_CHANCE=10`
- `ROUTINE_CHANCE=20`
- `VACATION_ROUTINE_CHANCE=60`

ただし、runtime で実際に使われているのは `VACATION_ROUTINE_CHANCE` だけだった。

今の `autonomous-action.sh` は、

- 昼間確率を `50`
- 深夜確率を `10`
- 通常時ルーチン率を `20`

として直書きしている。

そのため、現時点では `schedule.conf` を編集しても反映されない項目がある。

### 4. 最近のログでは `resume` より新規セッションが中心

`autonomous-action.sh` には `heartbeat-session-id` があれば `--resume` する処理がある。

ただし今回の調査時点では:

- `heartbeat-session-id` は存在しなかった
- 最近のログでは `[新規セッション作成]` が並んでいた

したがって、少なくとも最近の heartbeat では、長寿命セッション継続が支配的とは言いづらい。

旧メモにある「`--resume` が重いのでは」という仮説は、その当時には妥当でも、今の挙動にはそのまま当てはめられない。

### 5. 最近の時間帯別の active / skip

手元に残っている recent logs を集計すると、以下のようだった。

| 時刻 | active | skip |
|---|---:|---:|
| 00 | 0 | 2 |
| 02 | 0 | 2 |
| 04 | 0 | 2 |
| 06 | 0 | 2 |
| 08 | 0 | 2 |
| 10 | 1 | 1 |
| 12 | 2 | 0 |
| 14 | 0 | 2 |
| 16 | 1 | 1 |
| 18 | 2 | 0 |
| 20 | 3 | 0 |
| 22 | 2 | 0 |

これは最近残っているログだけを使った観測なので、長期傾向の確定ではない。
ただし、

- 深夜帯はほぼ落ちている
- 平日昼間は半分程度
- 18 時以降はほぼそのまま動く

という設計通りの形にはなっていた。

### 6. active run の所要時間

recent logs の active run は 11 件あり、所要時間はおおむね以下だった。

- 平均: 約 236 秒
- 最短: 33 秒
- 最長: 497 秒

時間帯別の平均は次の通り。

| 時刻 | 件数 | 平均秒 |
|---|---:|---:|
| 10 | 1 | 170 |
| 12 | 2 | 248.5 |
| 16 | 1 | 497 |
| 18 | 2 | 234 |
| 20 | 3 | 177.3 |
| 22 | 2 | 217.5 |

まだ token 数そのものではないが、「どの枠が長くなりやすいか」の粗い手がかりにはなる。

### 7. heartbeat ごとの token 使用量は取れていない

`autonomous-action.sh` は `claude -p --output-format json` で実行している。

しかしログに書いているのは基本的に `.result` だけで、usage 系の情報があっても保持していない。

つまり現状では、

- 各 heartbeat で何 token 使ったか
- どの時間帯の token が重いか
- ルーチン回と通常回でどちらが重いか

を直接は出せない。

### 8. 既存の日次 token 集計も今は機能していない

`.claude/scripts/system-health.ts` には `ccusage daily --json` を呼んで、その日の token と cost を取る実装がある。

ただし今回の環境では `ccusage` が見つからなかった。

結果として `.claude/workingDirs/system-health-history.json` の `tokens` は `null` のままだった。

つまり、日次集計の導線はあるが、現状は使えていない。

### 9. サブエージェント起因の増加は今のログでは追えない

今回見たログには、

- subagent を呼んだか
- そこでどれだけ token を使ったか
- 本体とサブエージェントのどちらが重かったか

を切り分ける情報がなかった。

したがって、「休日昼間の空論でサブエージェントが呼ばれて token を圧迫しているか」を今の仕組みだけで判断するのは難しい。

### 10. `朝の再構成` が毎回入っている可能性が高い

本来 `朝の再構成` は「その日初回だけ」のはずだが、最近の active run では毎回これが出ていた。

コード上では保存先が:

- `workingDirs/last-session-date.txt`

になっている。

一方、実際に存在している作業ディレクトリは:

- `.claude/workingDirs`

だった。

このずれのせいで、`last-session-date.txt` が保存されず、毎回「今日の初回セッション」と判定されている可能性が高い。

これは token 分布を観測するうえでもノイズになる。

### 11. 22-23 時台の追加処理は、少なくとも Claude token そのものではなさそう

22-23 時台には以下が自動実行される。

- `system-health.ts`
- `update-discussion-memo.ts`

今回見た範囲では、これらは Bun / SQLite / fetch ベースのローカル処理で、`claude -p` は呼んでいない。

したがって、22 時台が重い場合でも、まず疑うべきは heartbeat 本体の prompt と処理内容であり、これらの補助スクリプトは Claude token そのものの主因ではなさそう。

ただし注意点として、これらの追加処理は「分単位のスキップ判定より前」に走る。
そのため、将来 cron を 20 分おきに戻すと、22 時台・23 時台の追加処理は 1 時間に複数回走る設計になる。

## いま言える判断

- まず必要なのは、cron 時刻の見直しそのものではなく、計測の整備。
- 特に、次の 3 つを先にやるべき。

1. `朝の再構成` が毎回入る問題を直す
2. heartbeat ごとの token 使用量を保存する
3. ログ保持期間を伸ばして、平日 / 休日 / 休暇を比較できるようにする

## 次の実装候補

### A. 最優先

- `last-session-date.txt` の保存先を `.claude/workingDirs` に揃える
- `claude -p --output-format json` の戻り値から usage 情報を保存する
- active run ごとに以下をログへ残す
  - timestamp
  - hour
  - normal / routine
  - morning section の有無
  - bedtime extra の有無
  - token 使用量

### B. その次

- `schedule.conf` の値を実際に runtime で参照するように整理する
- ログ削除期間を延ばして、最低でも 1 週間比較できるようにする
- subagent を呼んだ heartbeat に印を付ける

### C. 計測後に決めること

- 平日昼間の 50% 帯をさらに絞るか
- 休日帯をどこまで active にするか
- ルーチン回の頻度を落とすか
- いわゆる重い時間帯や重い処理を別の時間へ逃がすか

## 現時点の要約

今回の調査で分かったのは、

- 実 cron は 2 時間おき
- token の時系列データはまだ取れていない
- `resume` より、むしろ毎回 `朝の再構成` が入っている可能性が高い
- `schedule.conf` の一部は死に設定

という点だった。

したがって、次の判断軸は「いつ動かすか」より先に、「何をどの粒度で測るか」を整えることになる。
