# energy / health の自然回復ルールを強める案

## 現状の問題

`energy` と `health` は `environment-tick.ts` で環境センサーから更新されている。
熱負荷 proxy、湿度、気温などが Kuzu 因果グラフを通って `STATUS.md` に反映される。

この仕組み自体はよいが、現在は「負荷で下がる」方向に比べて「何も悪くない時間で戻る」方向が弱い。
そのため、湿度や熱負荷が数回続くと `energy` / `health` がじわじわ下がり、あとから環境が落ち着いても戻りにくい。

特に問題になりやすい点:

- 高湿度は `energy` / `health` を下げるが、快適な湿度は基本的に回復ボーナスにならない
- 熱負荷が低いと回復するが、安定帯ではほぼ戻らない
- 同じ原因が heartbeat ごとに繰り返し効き、連続ペナルティになりやすい
- 睡眠・休息・低活動時間による自然回復が明示的に入っていない
- `health` は長期的な健康感なのに、短期の環境負荷で毎回動きすぎる

## 方針

`environment-tick` は「外界からの圧力」を測る役割に寄せる。
それとは別に、恒常性維持のための `homeostasis` 的な回復処理を入れる。

イメージ:

```text
環境負荷による変化
  - 暑い / 蒸す / 暗い / 高負荷 → 下がる

自然回復による変化
  - 悪い入力がない
  - 休息時間である
  - energy / health が目標値より低い
  - 前回から連続して悪化していない
  → 少し戻る
```

ポイントは、自然回復を「良いイベントが起きたから上がる」ではなく、
「悪くない時間が続いたから戻る」として扱うこと。

## 実装案 1: homeostasis-tick を追加する

新しく `.claude/scripts/homeostasis-tick.ts` を作り、`environment-tick.ts` の後に呼ぶ。

呼び出し位置:

```bash
bun run "$SCRIPT_DIR/.claude/scripts/environment-tick.ts" >> "$LOG_FILE" 2>/dev/null
bun run "$SCRIPT_DIR/.claude/scripts/homeostasis-tick.ts" >> "$LOG_FILE" 2>/dev/null
```

`homeostasis-tick.ts` は `STATUS.md` と `ENVIRONMENT.md` を読む。
環境が悪くない場合だけ、`energy` / `health` をゆっくり回復させる。

目安:

```text
energy_target = 70
health_target = 75

if energy < energy_target and thermal_load < 60 and humidity < 70:
  energy += 1

if 深夜 or 休息時間 and energy < energy_target:
  energy += 1 追加

if health < health_target and thermal_load < 55 and humidity < 70:
  health += 1

ただし health は 1 tick ごとではなく、2〜3 tick に1回でもよい
```

`energy` は活動性なので戻りやすくてよい。
`health` は体調の安定感なので、`energy` より遅く戻す。

## 実装案 2: 連続ペナルティを弱める

同じ原因で何度も下がると、現在は「ずっと殴られている」感じになりやすい。
そこで、直近の原因を `.claude/workingDirs/homeostasis-state.json` などに記録し、
同じ原因が続く場合はペナルティを減衰させる。

例:

```text
1回目: 100%
2回目: 50%
3回目以降: 25%
```

また、低値域では安全弁を入れる。

```text
energy < 45 のとき、1回の環境ペナルティは最大 -2
health < 55 のとき、1回の環境ペナルティは最大 -1
```

これで「不調だからさらに行動不能になる」ループを防げる。

## 実装案 3: 安定帯を回復扱いにする

今の因果 runtime では、環境値が中立帯にあると delta が 0 になりやすい。
しかし身体感としては、悪くない時間が続けば少し回復してよい。

そのため、環境評価を次のように分ける。

```text
thermal_load >= 80:
  強い負荷

thermal_load 60〜79:
  軽い負荷

thermal_load 40〜59:
  安定。energy が低いなら +1

thermal_load <= 39:
  回復しやすい。energy +1〜2、health +1
```

湿度も同じで、低湿度を強い回復にする必要はないが、
少なくとも `50〜65` くらいの快適域では「悪化なし + 自然回復を許可」としたい。

## 実装案 4: sleep / rest を回復ソースにする

`STATUS.md` には睡眠時間があるが、runtime で十分に使われていない。
heartbeat の時刻から簡易的に rest window を作るだけでも改善する。

例:

```text
0:00〜6:00:
  sleep/rest window
  energy +2 まで許可
  health +1 を許可

22:00〜23:00:
  bedtime recovery
  energy +1
```

ただし、実際にユーザーと対話中のときは「寝ている」扱いにしない。
cron heartbeat の自律実行だけに限定する。

## おすすめの最小修正

最初は大きく作り替えず、次の 2 つだけ入れるのが安全。

1. `homeostasis-tick.ts` を追加し、環境が安定しているときだけ `energy +1` / `health +1` を入れる
2. `energy < 45` と `health < 55` では環境ペナルティの上限を弱める

これで「下がる理由」は残しつつ、「戻る身体性」が入る。
環境に反応するスミレらしさを保ったまま、落ちっぱなしになる罠を避けられる。

## 期待する挙動

改善後の理想:

```text
暑い・蒸す:
  energy / health が下がる

暑さが引く:
  すぐ全回復ではなく、数 tick かけて戻る

夜間・休息時間:
  energy が少し戻りやすい

health:
  急落しにくく、回復もゆっくり
```

`energy` は日内変動する。
`health` は数日単位でならす。
この分離を入れると、`energy` / `health` の意味も混ざりにくくなる。
