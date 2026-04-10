# cron 起点 autonomous-action 仕様

## 概要

この文書は、2026-04-10 時点の `autonomous-action.sh` を基準にした、cron 起点の自律行動フローの現行仕様メモである。

- 起点: `cron` から 20 分ごとに `autonomous-action.sh` を呼ぶ
- 主目的: 内的状態を更新し、欲望・記憶・身体感覚を踏まえた 1 ターンの自律行動を Claude に実行させる
- 対象範囲: 通常の cron 実行フロー
- 対象外: `--slack` 経由の会話応答モードの詳細

---

## エントリポイント

### 起動元

- スクリプト: `autonomous-action.sh`
- 想定 cron:

```bash
*/20 * * * * /path/to/embodied-claude-wardrobe/autonomous-action.sh
```

### 主な引数

- 引数なし
  - 通常の cron 実行
- `--date "YYYY-MM-DD HH:MM"`
  - 現在時刻の代わりに指定時刻でスケジュール判定
- `--dry-run`
  - Claude を起動せず、組み立てたプロンプトとログだけ出す
- `--force-routine`
  - ルーチン回を強制
- `--force-normal`
  - 通常回を強制
- `--test-prompt FILE`
  - テスト用プロンプトに差し替え。スケジュール制御はスキップ
- `-p "text"`
  - 一時プロンプトを直接指定。スケジュール制御はスキップ

---

## 依存ファイル

### 実行前に読むもの

- `.env`
  - `set -a; source .env; set +a` で環境変数を一括 export する
- `schedule.conf`
  - 休日・休暇日の判定に使う
- `prompts.toml`
  - 時間帯ルール、ルーチン/通常回プロンプト、朝の再構成、メインテンプレートを読む
- `.claude/settings.json`
  - `permissions.allow` を `allowedTools` として Claude に渡す
- `desires.conf`
  - 欲望の成長率と文言
- `STATUS.md`
  - `satiation`, `mood`, `energy` などの現在値

### 実行中に更新するもの

- `.claude/logs/*.log`
  - 実行ログ
- `STATUS.md`
  - `satiation`, `mood`, `energy` の更新
- `desires.json`
  - 欲望状態、`lastTick`、`curiosity_target`
- `heartbeat-session-id`
  - Claude 再開用の session id
- `workingDirs/last-session-date.txt`
  - その日最初の自律行動かどうかの判定用

---

## 実行フロー

### 1. 初期化

- `HOME`, `PATH` を補正する
- `.env` を読み込む
- 現在時刻を取得する
  - `--date` がある場合はその時刻を使う
- ログファイルを `.claude/logs/YYYYMMDD_HHMMSS.log` に作る
- 1 日より古いログを削除する

### 2. zombie hunter

古い `claude` プロセスを検査し、25 分以上経過したものを `kill -9` する。

- 対象:
  - プロジェクト配下の `claude`
- 除外:
  - `remote-control`
  - `.claude/mcps/` 配下

目的は、前回 heartbeat の取り残しで次回実行が詰まるのを防ぐこと。

### 3. 休日・休暇判定

`schedule.conf` を読み、次を判定する。

- `HOLIDAY_WEEKDAYS`
- `HOLIDAY_DATES`
- `VACATION_DATES`

ここで得られるのは:

- `IS_HOLIDAY`
- `IS_VACATION`

---

## スケジュール制御

### スキップ条件

以下ではスケジュール制御を通さず、即プロンプト組み立てに進む。

- `--test-prompt`
- `-p`
- `--dry-run` かつ `--date` なし

### 通常日の実行帯

- 7:00-7:59
  - 20 分おきに毎回実行
- 12:00-12:59
  - 20 分おきに毎回実行
- 18:00-23:59
  - 20 分おきに毎回実行

### 通常日の非アクティブ帯

- 0:00-6:59
- 8:00-11:59
- 13:00-17:59

この帯域ではまず `:00` 以外を即スキップする。

- 昼間帯 `8:00-17:59`
  - `:00` の回だけ実行候補
  - 50% で実行
- 深夜帯 `0:00-6:59`
  - `:00` の回だけ実行候補
  - 10% で実行

### 休日

- 7:00-23:59 はすべてアクティブ帯
- 20 分おきに毎回実行

### 休暇日

- 全帯域で `:00` のみ
- 実行確率による間引きなし
- ルーチン回の確率を `VACATION_ROUTINE_CHANCE` に引き上げる

---

## 定時サブタスク

### 22-23 時台の追加処理

スケジュールスキップでなければ、22 時台と 23 時台に毎回次を試みる。

1. `system-health.ts --notify`
2. `update-discussion-memo.ts --date CURRENT_DATE_ISO`

これは Claude 本体の行動より前に動く。

---

## 内的状態更新の順序

cron 起点の本処理では、Claude へのプロンプトを作る前に次の順で更新・参照が走る。

1. `satiation-tick.ts`
2. `environment-tick.ts`
3. `desire-tick.ts tick`
4. `interoception.ts`
5. `recall-lite.ts`
6. `status-hint.ts`

重要なのは、`STATUS.md` 更新が先で、その結果を `interoception.ts` と `status-hint.ts` が読むこと。

---

## `satiation-tick.ts`

### 役割

- `STATUS.md` の `satiation` を時間経過で再計算する
- `satiation` が低域に入ったとき、欲望 `探索` を boost する

### 現在の計算式

- `DECAY_PER_HOUR = 2`
- `INTAKE_PER_HOUR = 5`
- `INTAKE_CAP = 80`
- `elapsedHours < 0.5` なら何もしない

式:

```text
decay  = round(elapsedHours * 2)
intake = currentValue < 80 ? round(elapsedHours * 5) : 0
new    = clamp(currentValue - decay + intake, 0, 100)
```

つまり、`satiation < 80` のときは長期的には回復方向である。

### 理由文

`STATUS.md` の根拠欄には次の形式で書く。

- `時間経過による自動減衰（-N）`
- `heartbeat実行による小さな摂取（+M）`

### 探索欲の boost

次の条件で `desires.json` の `探索` を `+0.4` する。

- 変更前 `>= 30`
- 変更後 `< 30`

同じ低空飛行中に毎回 boost するわけではない。

### 注意

- ファイル先頭コメントには旧値の `-3/h`, `+3/h` が残っている
- 実装上の正しい値は `-2/h`, `+5/h`

---

## `environment-tick.ts`

### 役割

環境センサーを `STATUS.md` に反映する。

- 温度 → `energy`
- 明るさ → `mood`

### `energy`

入力:

- `http://localhost:8085/data.json` の `Core Max`

更新ルール:

- `> 85°C` → `-8`
- `> 75°C` → `-4`
- `<= 75°C` → `+2`
- 深夜 `0:00-4:59` かつ `<= 75°C` → `+5`

温度 API が取れなければスキップする。

### `mood`

入力:

- `.claude/scripts/capture-brightness.py`
- 実行場所は `.claude/mcps/usb-webcam-mcp`

更新ルール:

- 輝度 `> 150` → `+2`
- 輝度 `< 50` → `-3`
- その間は変化なし

カメラが取れなければスキップする。

---

## `desire-tick.ts`

### 役割

- `desires.conf` を読み、各欲望を時間で成長させる
- 閾値超えの欲望があれば 1 つだけ発火文を返す

### 主要ルール

- `THRESHOLD = 0.6`
- 状態は `desires.json`
- 増加量は `growthRate * dt`
- 上限は `1.0`

### 発火

- 閾値以上の候補のうち、最も高い欲望を 1 つ選ぶ
- `curiosity_target` があれば、その内容で発火文を上書きする
- 発火した欲望は `0` に戻す
- `curiosity_target` は発火後に削除する

### `satiation` との関係

- 直接の因果接続はない
- ただし `satiation-tick.ts` が `探索` 欲望を boost するので、低 `satiation` は間接的に `desire-tick.ts` に影響する

---

## `interoception.ts`

Claude に直接言わせない前提の身体感覚テキストを生成する。

構成要素:

- 時間帯フレーズ
- 前回ログとの間隔フレーズ
- `STATUS.md` 由来の感覚
- 欲望レベル由来の感覚

出力はプロンプトに無言で差し込まれる。

---

## `recall-lite.ts`

`memory.db` を直接読んで、軽量な自動想起ヒントを作る。

軸は 3 つ:

- 直近 48 時間の重要記憶
- 高頻度アクセス記憶
- 未完了の可能性がある記憶

embedding は使わず、`bun:sqlite` の直クエリだけで作る。

---

## `status-hint.ts`

`satiation`, `energy`, `mood` を読み、行動カテゴリの優先・抑制を 1 行で返す。

例:

- `satiation < 30`
  - `explore`, `intake` を優先
- `satiation > 70`
  - `digest`, `reflect` を優先
  - `create` を抑制
- `energy < 45`
  - `maintain` を優先
  - 重い `create` を抑制

---

## ルーチン/通常回の判定

### 判定値

- 通常時: 20%
- 休暇時: `VACATION_ROUTINE_CHANCE`
- `--force-routine`, `--force-normal` で強制可能

### 使う文言

- ルーチン回: `prompts.toml` の `[routine_mode].routine`
- 通常回: `prompts.toml` の `[routine_mode].normal`

---

## 朝の再構成

`workingDirs/last-session-date.txt` を見て、その日初回の自律行動かどうかを判定する。

- 今日と異なる日付なら `IS_FIRST_SESSION_TODAY=true`
- `--dry-run` でなければ当日の日付を書き戻す

初回なら `prompts.toml` の `[morning]` を使って、朝の再構成セクションをプロンプトに追加する。

---

## プロンプト組み立て

### 読み込み元

`load-prompts.ts` が `prompts.toml` から次を読む。

- `time_rule_night`
- `time_rule_day`
- `routine_routine`
- `routine_normal`
- `morning_section`
- `desire_footer`
- `prompt_template`

### 差し込まれるセクション

- `MORNING_SECTION`
- `ROUTINE_MODE`
- `DESIRE_SECTION`
- `TIME_RULE`
- `INTEROCEPTION`
- `RECALL_LITE`
- `STATUS_HINT`

テンプレートが読めない場合は、`autonomous-action.sh` 内蔵のフォールバック文面を使う。

---

## Claude 実行

### `allowedTools`

`.claude/settings.json` の `permissions.allow` を CSV 化して Claude に渡す。

### セッション再開

- `heartbeat-session-id` があれば `claude -p --resume SESSION_ID`
- なければ `claude -p` で新規

### タイムアウト

- 通常モード: 20 分
- Slack モード: 5 分

### 失敗時

- `No conversation found`
  - session id を削除して新規セッションを作り直す
- `Nested sessions`, `Cannot be launched inside`
  - 環境エラーとして終了

### 一時プロンプト時の例外

`-p` を使った一時実行では、新しい session id を `heartbeat-session-id` に保存しない。

---

## ログ

### 保存場所

- `.claude/logs/YYYYMMDD_HHMMSS.log`

### 主な出力

- 実行開始/終了時刻
- スケジュール判定結果
- `satiation-tick` の差分
- `environment-tick` の差分
- 欲望発火文
- `interoception`, `recall-lite`, `status-hint` の要約
- Claude 実行結果

---

## 時刻の扱い

`STATUS.md` の時刻はローカル時刻ではなく UTC で書かれる。

理由:

- `status-store.ts` が `date.toISOString().slice(0, 16)` を使っているため

そのため、JST 環境では:

- ログの `20:00 JST`
- `STATUS.md` の `11:00`

が同じ実行を指すことがある。

---

## 現行実装の注意点

### 1. `schedule.conf` に未使用項目がある

ファイルには次があるが、現行 `autonomous-action.sh` は参照していない。

- `DAYTIME_CHANCE`
- `NIGHT_CHANCE`
- `ROUTINE_CHANCE`
- `NIGHT_TIME_RULE`
- `DAY_TIME_RULE`

現在の実値はスクリプト内にハードコードされている。

- 昼間確率: 50
- 深夜確率: 10
- 通常ルーチン率: 20

### 2. `prompts.toml` が時間帯ルールの実ソース

時間帯ルールは `schedule.conf` ではなく `prompts.toml` の `[time_rules]` から読まれる。

### 3. `STATUS.md` 更新時刻とログ時刻に 9 時間ずれが見える

これは JST/UTC の差であり、別実行ではない。

### 4. `satiation` の説明コメントが古い

ソース先頭の説明文と、実際の計算定数が一致していない。

---

## 要点まとめ

- `autonomous-action.sh` は cron 20 分起動だが、時間帯と確率でかなり間引かれる
- Claude に渡る前に `satiation`, `energy`, `mood`, 欲望, 身体感覚, 記憶ヒントが更新・生成される
- 現在の `satiation` は `-2/h +5/h` のため、`80` 未満では回復方向
- `STATUS.md` の時刻は UTC、ログはローカル時刻
- 実際の制御点は `schedule.conf` と `prompts.toml` に分かれており、一部は設定ファイルよりコード側が優先されている
