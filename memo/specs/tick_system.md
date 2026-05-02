# tick 系スクリプト仕様メモ

## 概要

この文書は、2026-04-29 時点の実装に基づく `*-tick.ts` 系スクリプトの仕様メモである。

このリポジトリでの `tick` は、常駐 daemon の 1 フレームではなく、`autonomous-action.sh`
が自律行動ターンを始める直前に走らせる「時間経過・環境変化・内部衝動の更新単位」を指す。
言い換えると、1 回の heartbeat が Claude に渡される前に、身体や環境の状態を少し進める処理である。

主な対象:

- `satiation-tick.ts`
- `environment-tick.ts`
- `desire-tick.ts tick`

関連するが tick ではないもの:

- `interoception.ts`: 更新後の `STATUS.md` や欲望値から身体感覚テキストを作る
- `recall-lite.ts`: 自動想起ヒントを作る
- `status-hint.ts`: `STATUS.md` から行動ヒントを作る
- `causal-hint.ts`: 直近の因果ランタイム結果からヒントを作る

---

## tick はいつ呼ばれるか

入口は [autonomous-action.sh](/home/mizuho/develop/embodied-reflecta/autonomous-action.sh:1)。
想定 cron は 20 分ごとの起動である。

```bash
*/20 * * * * /path/to/embodied-reflecta/autonomous-action.sh
```

ただし、cron で `autonomous-action.sh` が起動しても、tick が必ず走るわけではない。
実際には次のゲートを通過した場合だけ呼ばれる。

1. 引数を解釈し、現在時刻または `--date` の時刻を決める
2. `schedule.conf` から休日・休暇日を判定する
3. スケジュール制御で早期 `exit 0` されなかった場合、tick に進む

スケジュール制御の実装箇所は
[autonomous-action.sh](/home/mizuho/develop/embodied-reflecta/autonomous-action.sh:198)。

通常日の実行候補:

- `7:00-7:59`: 20 分おきに毎回
- `12:00-12:59`: 20 分おきに毎回
- `18:00-23:59`: 20 分おきに毎回
- `8:00-11:59`, `13:00-17:59`: `:00` の回だけ候補になり、50% で実行
- `0:00-6:59`: `:00` の回だけ候補になり、10% で実行

休日:

- `7:00-23:59` は 20 分おきに毎回
- `0:00-6:59` は通常の非アクティブ帯と同じく、`:00` かつ 10% の実行候補

休暇日:

- 全時間帯で `:00` のみ実行
- 実行確率による間引きはしない
- ルーチン回の確率だけ `VACATION_ROUTINE_CHANCE` に上がる

### tick が呼ばれないモード

`SKIP_SCHEDULE=true` になる実行では、tick 群は呼ばれない。
該当条件は [autonomous-action.sh](/home/mizuho/develop/embodied-reflecta/autonomous-action.sh:207)。

- `--test-prompt FILE`
- `-p "text"`
- `--dry-run` かつ `--date` なし

Slack 経由は通常 `--slack ... -p "message"` で呼ばれるため、`-p` によって tick は呼ばれない。

注意点として、`--dry-run --date "YYYY-MM-DD HH:MM"` は `SKIP_SCHEDULE=true` にならない。
指定時刻がスケジュールを通過した場合、Claude 本体は起動しないが、tick は実状態を書き換える。
テスト時に状態を動かしたくない場合は、`--dry-run` 単体か `--test-prompt` を使う。
なお、`--date` は `autonomous-action.sh` のスケジュール判定用であり、
各 tick スクリプトには渡されない。`satiation-tick.ts` や `desire-tick.ts tick` の
経過時間計算は、実行時点の実時計を使う。

---

## 呼び出し順序

tick は、ルーチン回・通常回の判定後、Claude 向けプロンプトを組み立てる前に走る。
実装箇所は [autonomous-action.sh](/home/mizuho/develop/embodied-reflecta/autonomous-action.sh:326)。

順序:

1. `satiation-tick.ts`
2. `environment-tick.ts`
3. `desire-tick.ts tick`
4. `interoception.ts`
5. `recall-lite.ts`
6. `status-hint.ts`
7. `causal-hint.ts`

この順序には意味がある。

- `satiation-tick.ts` は低充足時に `探索` 欲望を boost するため、`desire-tick.ts tick` より前に走る
- `environment-tick.ts` は `STATUS.md` と `ENVIRONMENT.md` を更新するため、`interoception.ts` や `status-hint.ts` より前に走る
- `desire-tick.ts tick` の標準出力は `DESIRE_PROMPT` としてプロンプトの `内部衝動` セクションに入る
- `interoception.ts` 以降は、更新済みの状態を読んで Claude へ渡す補助テキストを作る

---

## satiation-tick.ts

実装: [satiation-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/satiation-tick.ts:1)

### 役割

`STATUS.md` の `satiation` を、最終更新からの経過時間に応じて再計算する。
同時に、heartbeat が起きたこと自体を「小さな摂取」として扱う。

### 入出力

入力:

- `STATUS.md` の `satiation` 現在値と最終更新時刻
- `desires.json` の `探索` 値

出力:

- `STATUS.md` の `satiation`
- 条件を満たした場合だけ、`desires.json` の `探索`
- 実行ログに `[satiation-tick] ...`

### 更新ルール

実装上の入口は [main()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/satiation-tick.ts:25)。

`satiation` が存在しない場合は何もしない。
最終更新から 30 分未満の場合も何もしない。

現在の実装定数:

- `DECAY_PER_HOUR = 2`
- `INTAKE_PER_HOUR = 5`
- `INTAKE_CAP = 80`

計算式:

```text
elapsedHours = (now - satiation.updatedAt) / 1 hour
decay = round(elapsedHours * 2)
intake = currentValue < 80 ? round(elapsedHours * 5) : 0
newValue = clamp(currentValue - decay + intake, 0, 100)
```

`currentValue < 80` のときだけ摂取が入るため、80 未満では長期的に回復寄りになる。
80 以上では摂取が止まり、時間経過による減衰だけになる。

状態テキスト:

- `>= 80`: 満ちている。消化したい感覚がある。
- `55-79`: 適度に満たされている。
- `30-54`: 何かを欲している。
- `< 30`: 空っぽに近い。新しいものを探したい。

### 探索欲の boost

更新前が `30` 以上で、更新後が `30` 未満になった瞬間だけ、
`desires.json` の `探索` を `+0.4` する。
実装箇所は [satiation-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/satiation-tick.ts:71)。

```text
探索 = min(1.0, 探索 + 0.4)
```

これは低空飛行中に毎回 boost する仕組みではなく、`30` を下回る境界をまたいだときだけ発火する。

### 注意

ファイル先頭コメントには旧値の `-3/h`, `+3/h` が残っている。
現行の正しい実装値は `-2/h`, `+5/h`。

---

## environment-tick.ts

実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:1)

### 役割

環境観測を取り、`ENVIRONMENT.md` に保存し、その観測から `STATUS.md` の
`mood`, `energy`, `health` 更新候補を作る。

詳細な計測仕様は [measure_environment_data.md](/home/mizuho/develop/embodied-reflecta/memo/specs/measure_environment_data.md:1)。
ここでは tick としての流れだけをまとめる。

### 入出力

入力:

- `ENVIRONMENT.md` の補助状態
- 旧互換状態 `.claude/workingDirs/environment-state.json`
- LHM HTTP API の CPU 温度
- WiFi カメラの ROI 輝度
- 気象庁 AMeDAS の気温・湿度
- 因果 runtime の seed / graph

出力:

- `ENVIRONMENT.md` の現在値・補助状態・履歴
- `.claude/workingDirs/environment-state.json`
- `STATUS.md` の `mood`, `energy`, `health`
- causal runtime snapshot
- persona structured store
- 実行ログに `[environment-tick] ...`

### 処理フロー

実装上の入口は [main()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:457)。

1. `ENVIRONMENT.md` と旧 JSON 状態を読む
2. 温度 baseline、輝度 baseline、ROI などの補助状態を復元する
3. CPU Core Max 温度を取得し、環境熱負荷 proxy を作る
4. WiFi カメラから ROI 輝度を取得し、環境光を作る
5. 気象庁 AMeDAS から気温・湿度を取得する
6. 取得できた観測値を `ENVIRONMENT.md` に保存する
7. 観測値を `causalInputs` として因果 runtime に渡す
8. 因果 runtime が成功したら、その proposal で `STATUS.md` を更新する
9. 因果 runtime を呼ばなかった場合、または因果 runtime が失敗した場合だけ fallback 更新を使う
10. 旧 JSON 状態と persona structured store を同期する

### 温度からの更新

CPU 温度は [getCpuCoreMax()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:404)
で取得する。取得先は `http://localhost:8085/data.json`。

絶対温度ではなく、EMA baseline からの差分で扱う。

```text
nextBaseline = EMA(previousBaseline, currentTemp, alpha=0.2)
relativeDelta = nextBaseline - currentTemp
thermalLoad = clamp(round(50 - relativeDelta * 4), 0, 100)
energyDelta = clamp(round(relativeDelta * 0.8), -8, +5)
```

温度観測は次に使われる。

- `ENVIRONMENT.md` の `environment_thermal_load`
- 因果 runtime 入力 `environment_thermal_load`
- fallback 更新の `energy`
- fallback 更新の `health`

### 明るさからの更新

WiFi カメラ輝度は
[getRoomBrightness()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:431)
で取得する。

実行される処理:

```bash
uv run python .claude/scripts/capture-brightness-wifi.py --roi <roiSpec>
```

輝度は `0-255` の平均値として取り、実輝度を `0-100` に正規化する。
暗さ判定は baseline に吸収しない。

```text
normalizedValue = clamp(round((brightness / 255) * 100), 0, 100)
```

fallback の `mood` 更新:

- `bright`: `+2`
- `dark`: `-3`
- `dim` / `neutral`: `0`

因果 runtime が成功した場合は、fallback ではなく runtime proposal が使われる。

### 気象庁 AMeDAS からの更新

[loadJmaWeatherObservationBundle()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:365)
が気温・湿度を取得し、取れたものだけを `ENVIRONMENT.md` と `causalInputs` に入れる。

取得失敗時は、その観測をスキップしてログを出す。
温度・カメラ・AMeDAS のどれかが失敗しても、`environment-tick.ts` 全体を即失敗させる設計ではない。

---

## desire-tick.ts tick

実装: [desire-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/desire-tick.ts:1)

### 役割

`desires.conf` に定義された欲望を、前回 tick からの経過秒数で成長させる。
閾値を超えた欲望があれば、最も強いものを 1 つだけ標準出力に出す。

`autonomous-action.sh` はこの標準出力を `DESIRE_PROMPT` として受け取り、
Claude へのプロンプトに `内部衝動` セクションとして差し込む。
呼び出し箇所は [autonomous-action.sh](/home/mizuho/develop/embodied-reflecta/autonomous-action.sh:336)。

### 入出力

入力:

- `desires.conf`
- `desires.json`

出力:

- `desires.json`
- 閾値超えがあった場合だけ標準出力に欲望プロンプト
- 実行ログの `[欲望発火]` または `[欲望] 閾値未達`

### 更新ルール

実装上の入口は [tick()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/desire-tick.ts:57)。

固定値:

- `THRESHOLD = 0.6`
- `DEFAULT_LEVEL = 0.0`

計算式:

```text
dt = now - state.lastTick
desire[name] = min(1.0, current + growthRate * dt)
```

`growthRate` は `desires.conf` の 2 列目で、秒あたりの増加量として扱われる。
現在の設定では、例として次の欲望がある。

- `記憶を刻む`
- `振り返り`
- `読書`
- `休息`
- `記憶整理`
- `探索`

### 発火ルール

1. `0.6` 以上の欲望を候補にする
2. 候補のうち、最も level が高いものを 1 つ選ぶ
3. `curiosity_target` があれば、出力文を curiosity 用の文に差し替える
4. 発火した欲望を `0` に戻す
5. `curiosity_target` を削除する
6. `lastTick` を現在時刻に更新して保存する

`curiosity_target` は、候補欲望が閾値を超えたときにだけ出力へ反映される。
`curiosity_target` が存在するだけで即発火するわけではない。

候補がなかった場合、標準出力は空のまま `lastTick` だけ更新される。
そのため、欲望は「実行された tick 間隔」ごとに積み上がる。

### 補助コマンド

`desire-tick.ts` には `tick` 以外の手動コマンドもある。
実装箇所は [desire-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/desire-tick.ts:167)。

- `status`: 現在値と発火までの見込みを表示する
- `satisfy <name>`: 指定欲望を `0` に戻す
- `boost <name> [amount]`: 指定欲望を増やす
- `set-curiosity <target>`: 次回発火時の curiosity 文を設定する

これらは `autonomous-action.sh` の通常 tick ではなく、手動操作用である。

---

## tick 間の依存関係

```text
cron
  -> autonomous-action.sh
    -> schedule gate
    -> routine / normal decision
    -> satiation-tick
         STATUS.md:satiation
         desires.json:探索 boost
    -> environment-tick
         ENVIRONMENT.md
         STATUS.md:mood/energy/health
         causal runtime snapshot
    -> desire-tick tick
         desires.json
         stdout -> DESIRE_PROMPT
    -> interoception / recall-lite / status-hint / causal-hint
    -> prompt assembly
    -> claude -p
```

重要な依存:

- `satiation-tick` は `desire-tick tick` の前にあり、`探索` の発火しやすさを変える
- `environment-tick` は `interoception.ts` と `status-hint.ts` の前にあり、身体感覚や行動ヒントの材料を更新する
- `desire-tick tick` は状態更新だけでなく、プロンプト本文に入る唯一の tick である
- `environment-tick` の causal runtime 結果は、同じ heartbeat 内の `causal-hint.ts` から参照されうる

---

## 障害時の扱い

`autonomous-action.sh` は tick 呼び出しに対して、基本的に強い失敗停止をかけていない。

- `satiation-tick.ts`: 標準出力はログへ追記、標準エラーは捨てる
- `environment-tick.ts`: 標準出力はログへ追記、標準エラーは捨てる
- `desire-tick.ts tick`: 標準出力を `DESIRE_PROMPT` として捕捉し、標準エラーは一時ファイル経由でログに出す

そのため、個別 tick が失敗しても、多くの場合は後続のプロンプト組み立てへ進む。
これは「センサーや補助状態が取れないだけで heartbeat 全体を止めない」ための運用である。

---

## 運用上の注意

- tick は実状態を書き換える。調査目的で直接実行する場合も `STATUS.md`, `ENVIRONMENT.md`, `desires.json` が更新される
- `--dry-run --date` は tick を実行しうるので、純粋なプロンプト確認には向かない
- `satiation-tick.ts` の先頭コメントは旧パラメータのままなので、仕様を書くときは実装定数を優先する
- `desire-tick.ts tick` は、閾値未達でも `lastTick` を更新する。手動で何度も実行すると欲望の蓄積間隔がリセットされる
- `environment-tick.ts` はセンサーごとに失敗をスキップする。どの観測が入ったかは `.claude/logs/*.log` と `ENVIRONMENT.md` の履歴を見る
