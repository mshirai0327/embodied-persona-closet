# Claude Token Usage Report

- 調査日: 2026-04-23
- 対象 repo: `embodied-reflecta`
- 対象期間: 2026-04-16 から 2026-04-23 まで
- タイムゾーン: JST
- 目的: Claude token 使用量の時間分布と曜日分布を把握し、cron 時間変更や重い処理の見直し方針を決める

## 結論

- この期間の総 token 使用量は **139,080,697 tokens** だった。
- 内訳は **main 124,451,563 tokens (89.5%)**、**subagent 14,629,134 tokens (10.5%)**。
- `main` をさらに分けると、**manual main 97,463,366 tokens (70.1%)**、**autonomous main 26,988,197 tokens (19.4%)** だった。
- `autonomous` 全体では **39,684,199 tokens (28.5%)** を使っており、無視できる量ではないが、**repo 全体の最大の塊は manual main** だった。
- 時刻別では **20時台** が最大で、次点は **16時台、8時台、10時台、23時台**。
- 曜日別では **土曜** が突出して多く、次に **金曜、日曜** が続く。
- 少なくともこの観測期間では、**圧迫の主因は subagent ではなく本体の Sonnet 実行量**。
- ただし **14時台、18時台、22時台** は subagent 比率が相対的に高めで、重い空論や分岐の影響を見る候補になる。
- `autonomous` の subagent は、観測期間では **記憶想起・因果連鎖探索が中心**だった。`server_tool_use.web_search_requests` と `web_fetch_requests` は **0** で、少なくとも今回の範囲では **web 検索が主因ではない**。

## 今回の集計で何を数えたか

今回の token は、Claude の usage に含まれる以下の合計として扱った。

- `input_tokens`
- `output_tokens`
- `cache_creation_input_tokens`
- `cache_read_input_tokens`

つまり、ここでの「total tokens」は単純な入出力だけではなく、**cache creation / cache read を含んだ総量**である。

## データソース

今回の調査では 2 つの経路を使った。

### 1. `ccusage`

- `ccusage daily --json`
- `ccusage session --json`

これで日次合計と session 単位の usage を確認した。

### 2. Claude Code の生 JSONL

以下を直接走査した。

- `~/.claude/projects/-home-mizuho-develop-embodied-reflecta/*.jsonl`
- `~/.claude/projects/-home-mizuho-develop-embodied-reflecta/**/subagents/*.jsonl`

こちらを使った理由は、`ccusage` の日次合計だけでは

- 時刻別
- 曜日別
- subagent の寄与

が十分に見えないため。

## 集計手法

### 1. `requestId` 単位で重複除去した

Claude Code の JSONL は、同じ request が

- `thinking`
- `text`
- `tool_use`

のように複数行へ分かれて記録されることがある。

そのため、JSONL をそのまま足すと大きく過大集計になる。

今回は **`requestId` ごとに 1 回だけ採用**することで重複を除去した。

この補正後の合計は `ccusage daily --json` の日次合計と一致したため、今回の集計方法は妥当と判断した。

### 2. timestamp は UTC から JST に変換した

JSONL の timestamp は UTC なので、時刻別・曜日別の集計では JST に直してから集計した。

### 3. subagent はディレクトリで切り分けた

- main: `.../-home-mizuho-develop-embodied-reflecta/*.jsonl`
- subagent: `.../-home-mizuho-develop-embodied-reflecta/**/subagents/*.jsonl`

これで、本体と subagent を分けて集計した。

## 調査に使ったコマンド例

```bash
ccusage --version
ccusage daily --json
ccusage session --json

find ~/.claude/projects/-home-mizuho-develop-embodied-reflecta -maxdepth 3 -type f

sed -n '1,20p' ~/.claude/projects/-home-mizuho-develop-embodied-reflecta/<session>.jsonl
rg -n 'usage|timestamp|requestId' ~/.claude/projects/-home-mizuho-develop-embodied-reflecta/<session>.jsonl
```

## 観測結果

### 1. 総量

| 区分 | tokens | 比率 |
|---|---:|---:|
| main | 124,451,563 | 89.5% |
| subagent | 14,629,134 | 10.5% |
| total | 139,080,697 | 100.0% |

この範囲では、token の大半は main 側で消費されている。

### 2. 日別の分布

| 日付 | total tokens |
|---|---:|
| 2026-04-16 | 7,037,508 |
| 2026-04-17 | 28,174,113 |
| 2026-04-18 | 53,369,490 |
| 2026-04-19 | 24,797,917 |
| 2026-04-20 | 11,774,615 |
| 2026-04-21 | 7,446,343 |
| 2026-04-22 | 5,480,502 |
| 2026-04-23 | 1,000,209 |

日別の見た目はこうなる。

```text
Daily Total Tokens

04-16 ###                      7.0M
04-17 #############           28.2M
04-18 ######################## 53.4M
04-19 ###########             24.8M
04-20 #####                   11.8M
04-21 ###                      7.4M
04-22 ##                       5.5M
04-23                          1.0M
```

`2026-04-18` が突出しており、その次が `2026-04-17`, `2026-04-19` だった。

### 3. 時刻別の分布

時刻別では以下のようになった。

| 時刻 | total tokens | 全体比 | subagent 比率 |
|---|---:|---:|---:|
| 00 | 6,306,024 | 4.5% | 7.9% |
| 02 | 688,078 | 0.5% | 40.3% |
| 06 | 2,141,123 | 1.5% | 0.0% |
| 07 | 8,119,958 | 5.8% | 2.7% |
| 08 | 10,484,787 | 7.5% | 12.0% |
| 09 | 5,139,161 | 3.7% | 0.0% |
| 10 | 9,728,186 | 7.0% | 11.9% |
| 11 | 4,811,332 | 3.5% | 0.0% |
| 12 | 7,865,934 | 5.7% | 18.7% |
| 13 | 3,552,716 | 2.6% | 0.0% |
| 14 | 8,967,115 | 6.4% | 27.7% |
| 15 | 4,495,193 | 3.2% | 0.0% |
| 16 | 10,603,613 | 7.6% | 10.5% |
| 17 | 748,406 | 0.5% | 0.0% |
| 18 | 8,611,750 | 6.2% | 22.4% |
| 19 | 7,684,187 | 5.5% | 2.9% |
| 20 | 14,771,650 | 10.6% | 14.4% |
| 21 | 7,464,735 | 5.4% | 3.1% |
| 22 | 7,148,259 | 5.1% | 22.7% |
| 23 | 9,748,490 | 7.0% | 0.0% |

グラフにするとこう見える。

```text
Hour of Day (JST) — Total Tokens / Subagent Share

00 ##########                 6.3M   4.5%  sub= 7.9%
02 #                          0.7M   0.5%  sub=40.3%
06 ###                        2.1M   1.5%  sub= 0.0%
07 #############              8.1M   5.8%  sub= 2.7%
08 #################         10.5M   7.5%  sub=12.0%
09 ########                   5.1M   3.7%  sub= 0.0%
10 ################           9.7M   7.0%  sub=11.9%
11 ########                   4.8M   3.5%  sub= 0.0%
12 #############              7.9M   5.7%  sub=18.7%
13 ######                     3.6M   2.6%  sub= 0.0%
14 ###############            9.0M   6.4%  sub=27.7%
15 #######                    4.5M   3.2%  sub= 0.0%
16 #################         10.6M   7.6%  sub=10.5%
17 #                          0.7M   0.5%  sub= 0.0%
18 ##############             8.6M   6.2%  sub=22.4%
19 ############               7.7M   5.5%  sub= 2.9%
20 ########################  14.8M  10.6%  sub=14.4%
21 ############               7.5M   5.4%  sub= 3.1%
22 ############               7.1M   5.1%  sub=22.7%
23 ################           9.7M   7.0%  sub= 0.0%
```

時刻別の読みは次の通り。

- 最大は **20時台**
- 次点は **16時台**
- その次に **8時台、23時台、10時台**
- 深夜 2 時台の総量は小さいが、**subagent 比率だけは高い**
- **14時台、18時台、22時台** は subagent の寄与が相対的に高い

### 4. 曜日別の分布

今回観測できた曜日ごとの総量は以下だった。

| 曜日 | total tokens | 全体比 | subagent 比率 | 観測日数 |
|---|---:|---:|---:|---:|
| Mon | 11,774,615 | 8.5% | 14.7% | 1 |
| Tue | 7,446,343 | 5.4% | 36.7% | 1 |
| Wed | 5,480,502 | 3.9% | 26.7% | 1 |
| Thu | 8,037,717 | 5.8% | 8.7% | 2 |
| Fri | 28,174,113 | 20.3% | 8.7% | 1 |
| Sat | 53,369,490 | 38.4% | 5.6% | 1 |
| Sun | 24,797,917 | 17.8% | 10.4% | 1 |

グラフにするとこうなる。

```text
Weekday (JST) — Total Tokens / Avg per Observed Day / Subagent Share

Mon #####                     11.8M   8.5%  avg=11.8M  n=1  sub=14.7%
Tue ###                        7.4M   5.4%  avg= 7.4M  n=1  sub=36.7%
Wed ##                         5.5M   3.9%  avg= 5.5M  n=1  sub=26.7%
Thu ####                       8.0M   5.8%  avg= 4.0M  n=2  sub= 8.7%
Fri #############             28.2M  20.3%  avg=28.2M  n=1  sub= 8.7%
Sat ########################  53.4M  38.4%  avg=53.4M  n=1  sub= 5.6%
Sun ###########               24.8M  17.8%  avg=24.8M  n=1  sub=10.4%
```

曜日別の読みは次の通り。

- **土曜が突出**
- 次に **金曜、日曜**
- 木曜は 2 日観測されているので、単純総量ではなく `avg=4.0M` で見たほうが自然
- 平日昼間より、**週末側で全体 token が大きく膨らむ**傾向が見える

### 5. model 別

今回の対象期間では model 別にこうなった。

| model | tokens |
|---|---:|
| `claude-sonnet-4-6` | 124,451,563 |
| `claude-haiku-4-5-20251001` | 14,629,134 |

つまり、

- **本体: Sonnet**
- **subagent: Haiku**

という役割分担がそのまま usage に反映されていた。

## いま言える判断

### 1. まず疑うべきは本体 Sonnet 側

subagent は確かに使われているが、総量で見ると **約 10.5%**。

したがって、「token 圧迫の主因は subagent ではないか」という見立ては、この観測範囲では主因と言いづらい。

最初に見るべきは、

- main 側の prompt サイズ
- main 側の呼び出し回数
- main 側での長い tool 出力や cache read

のほう。

### 2. cron 見直し候補としては 20 時台と週末が強い

時刻別で最大は **20時台**、曜日別で最大は **土曜**。

このため、cron 方針の見直し候補としてはまず

- **20時台の重さ**
- **土曜 / 日曜の活性度**

を優先して見るのがよい。

### 3. subagent を見るなら 14時台、18時台、22時台

subagent 比率が目立つのは、

- **14時台**
- **18時台**
- **22時台**

だった。

総量の主因ではないが、「どの時間に空論や分岐探索が増えやすいか」を見るにはこの時間帯がよい候補になる。

## 深掘り: main を manual / autonomous に分ける

ここでいう `manual` は、**`自律行動（定期巡回）` の prompt を持たない top-level session** をまとめたもの。ふつうの会話だけでなく、ユーザー主導の実装・デバッグ・手動起動の作業も含む。
`autonomous` は、**top-level session の `queue-operation.content` または `last-prompt` に `自律行動（定期巡回）` が含まれる session** とした。subagent は親 session の種別を引き継いで集計した。

この切り分けは prompt ベースの分類なので、厳密な cron PID 対応ではない。ただし、`autonomous-action.sh` から入った session を usage 上で分離する用途には十分使える。

### 1. 4 区分に分けた token 使用量

| 区分 | tokens | 全体比 |
|---|---:|---:|
| manual main | 97,463,366 | 70.1% |
| autonomous main | 26,988,197 | 19.4% |
| autonomous subagent | 12,696,002 | 9.1% |
| manual subagent | 1,933,132 | 1.4% |
| total | 139,080,697 | 100.0% |

`manual` と `autonomous` を合算するとこうなる。

| 区分 | tokens | 全体比 |
|---|---:|---:|
| manual total | 99,396,498 | 71.5% |
| autonomous total | 39,684,199 | 28.5% |

見た目にするとこうなる。

```text
Token Split by Session Type

manual_main          ########################  97.5M  70.1%
autonomous_main      #######                   27.0M  19.4%
autonomous_subagent  ###                       12.7M   9.1%
manual_subagent                                 1.9M   1.4%
```

この結果から言えることは次の通り。

- **最大の塊は manual main**
- ただし `autonomous` も **約 28.5%** を占めており、見直し対象としては十分大きい
- `autonomous` では subagent 比率が **32.0%**、`manual` では **1.9%** だった

つまり、**repo 全体では main が主犯だが、autonomous の内部では subagent もかなり効いている**。

### 2. session 数と 1 session あたりの重さ

今回の観測期間では、top-level session 数は

- `manual`: 11 sessions
- `autonomous`: 44 sessions

だった。

平均すると、

- `manual` は **約 9.0M tokens / session**
- `autonomous` は **約 0.90M tokens / session**

となる。

つまり、**autonomous は回数が多いが 1 回あたりは軽め**で、**manual は回数が少ないのに 1 session がかなり重い**。

このため、「全体の土曜ピーク」「全体の 20 時台ピーク」は、まず `manual main` 側の寄与を疑うのが自然になる。

### 3. 曜日別に見ると、週末ピークの主体は manual

`autonomous` と `manual` を曜日別に分けると、かなり見え方が変わる。

```text
Autonomous Total by Weekday

Mon ###############            5.9M
Tue ###################        7.4M
Wed ##############             5.5M
Thu ###                        1.0M
Fri #########                  3.6M
Sat ##################         6.9M
Sun ########################   9.4M
```

```text
Manual Total by Weekday

Mon ###                        5.9M
Tue                            0.0M
Wed                            0.0M
Thu ####                       7.0M
Fri #############             24.6M
Sat ########################  46.4M
Sun ########                  15.4M
```

読みは次の通り。

- 前半で見えた **土曜突出** は、主に `manual` 側で起きている
- `autonomous` 単体では、**日曜 9.4M / 火曜 7.4M / 土曜 6.9M** が上位で、土曜だけが極端に抜けているわけではない
- したがって、**「週末に活発」という repo 全体の見え方を、そのまま cron/autonomous の性質だと解釈するとズレる**

### 4. 時刻別に見ると、autonomous は夕方から夜に山がある

`autonomous` だけを見ると、時刻別ピークはこうなる。

```text
Autonomous Total by Hour (JST)

00 ###                        0.9M
02 ###                        0.7M
08 #############              3.2M
10 ###############            3.9M
12 ##################         4.6M
14 ##################         4.7M
16 ####################       5.0M
18 ########################   6.2M
20 ####################       5.1M
22 #####################      5.3M
```

上位は、

- **18時台: 6.2M**
- **22時台: 5.3M**
- **20時台: 5.1M**
- **16時台: 5.0M**
- **14時台: 4.7M**

だった。

一方で `manual` 側の上位は、

- **23時台: 9.7M**
- **20時台: 9.6M**
- **07時台: 7.9M**
- **19時台: 7.7M**
- **21時台: 7.5M**

だった。

つまり、**repo 全体の 20 時台ピークは本当だが、その中身は `manual` の寄与が大きい**。
`autonomous` の時刻ピークを狙い撃ちするなら、まず見るべきなのは **18時台から22時台**。

### 5. autonomous subagent は何をしていたか

`autonomous` 44 session のうち、

- **43 session が subagent を起動**
- 1 session だけ subagent なし
- 平均 **2.57 subagents / autonomous session**

だった。

subagent の description は、ほぼ以下に集中していた。

- `因果的圧縮器`
- `感情的圧縮器`
- `技術的圧縮器`

これは `great-recall` 系の多軸想起と整合している。

さらに、`autonomous subagent` 内の `tool_use` を数えるとこうなった。

| tool | 回数 |
|---|---:|
| `mcp__memory__get_causal_chain` | 246 |
| `mcp__memory__recall` | 108 |
| `mcp__memory__recall_divergent` | 34 |
| `mcp__memory__recall_with_associations` | 32 |
| `Read` | 15 |
| `Bash` | 9 |
| `mcp__memory__get_memory_chain` | 5 |

全 `tool_use` 449 回のうち、**memory MCP 系は 425 回 (94.7%)** だった。
また、usage 内の `server_tool_use.web_search_requests` と `web_fetch_requests` は、`autonomous` 全体で **どちらも 0** だった。

少なくともこの観測期間では、**subagent は主に記憶想起・因果探索に使われており、web 検索が token を押し上げている形跡は見えない**。

### 6. それでも autonomous main が 27.0M ある理由

`autonomous main` が 27.0M あるのは、subagent を呼ぶ前から本体 Sonnet に固定コストがあるため。

実 session を見ると、autonomous の main では毎回かなり大きい文脈が入っている。

- prompt 冒頭で `@SOUL.md @BOOT_SHUTDOWN.md @TODO.md @ROUTINES.md`
- `SessionStart:startup` hook で `SOUL.md`, `BODY.md`, `STATUS.md`, `state.md`
- 初回なら `今日の初回セッション` の手順
- その上で `wd-great-recall`, `memory_stats`, `working_memory`, `TODO.md` 読み出し、ルーチン判定、実作業の選択

実際の `autonomous main` の tool 呼び出し回数も、かなり orchestration 寄りだった。

| tool | 回数 |
|---|---:|
| `Read` | 142 |
| `Agent` | 113 |
| `ToolSearch` | 90 |
| `Edit` | 88 |
| `Bash` | 80 |
| `Skill` | 64 |
| `mcp__memory__get_memory_stats` | 40 |
| `mcp__memory__refresh_working_memory` | 39 |

つまり、**autonomous main の token は「会話」だけでなく、起動時の大きな文脈注入 + 実行方針の選択 + skill / tool の司令塔コスト**として消えている。

### 7. ここから言える運用判断

`autonomous` を軽くしたいなら、優先順位は次の順が自然。

1. **18時台から22時台** の重さを見る
2. `wd-great-recall` の軸数や routine 回での subagent 起動数を見直す
3. 起動時に毎回入る `SOUL.md`, `BODY.md`, `STATUS.md`, `state.md`, `TODO.md`, `ROUTINES.md` の文量を点検する

逆に、**repo 全体の token 削減**を狙うなら、最初に効くレバーは依然として **manual main** である。

## 注意点

### 1. 今回は 8 日ぶんの観測

特に曜日別は、

- 木曜だけ 2 日
- それ以外は 1 日ずつ

なので、曜日一般の法則として断定するにはまだ短い。

### 2. 2026-04-23 は日途中の値

`2026-04-23` は 1 日完了前の集計なので、他日と単純比較はしにくい。

### 3. 前半は repo 全体、後半は prompt ベースの切り分け

このレポートの前半は `embodied-reflecta` repo に紐づく Claude Code usage 全体。
後半の `manual` / `autonomous` 切り分けは、session 内の prompt 文字列に基づく分類であり、cron ログとの直接突き合わせではない。

そのため、

- `autonomous-action.sh` の実行ログと 1 対 1 に一致する保証
- 手動 session 内の作業種別の厳密分解
- 特定 feature 作業単位の正確な切り出し

まではまだできていない。

## 次の深掘り候補

次に調べるなら、以下が自然。

### 1. cron ログと session ID を突き合わせる

- 実際の heartbeat ログ時刻と session ID を突き合わせる
- cron 枠ごとに token を見る

これができると、cron 時間変更の判断材料としてかなり直接的になる。

### 2. 起動時コンテキストの固定コストを測る

- `SOUL.md`, `BODY.md`, `STATUS.md`, `state.md`, `TODO.md`, `ROUTINES.md`
- startup hook
- 初回セッション専用セクション

のどこが main token を押し上げているかを測る。

### 3. `great-recall` の軸数と subagent 数を usage と突き合わせる

- 2 軸回
- 3 軸回
- routine 回
- 初回セッション回

を比較すると、autonomous のどこを削ると効くかが見える。

### 4. 18時台から22時台の重い session を個別に読む

- bedtime 系
- discussion memo
- TODO 実作業
- 記憶整理

のどれが本当に支配的かを、session 単位で切れる。

## 要約

- 対象期間の総 token は **139.1M**
- **main 89.5% / subagent 10.5%**
- 時刻別ピークは **20時台**
- 曜日別ピークは **土曜**
- subagent 比率が高めなのは **14時台、18時台、22時台**
- まず見直すべきは **本体 Sonnet 側の重さ** と **20時台・週末の運用**

現時点の判断としては、  
**「subagent が主犯」というより、repo 全体の main 側 usage が大きく、そのピークが 20時台と週末に寄っている」** がいちばん近い。
