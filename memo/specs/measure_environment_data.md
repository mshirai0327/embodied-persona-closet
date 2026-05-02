# 環境データ計測仕様メモ

## 概要

この文書は、2026-04-26 時点の実装に基づく `environment-tick.ts` 周辺の
環境データ計測仕様メモである。

対象:

- CPU 温度からの環境熱負荷 proxy 計測
- WiFi カメラ画像からの環境光計測
- 気象庁 AMeDAS からの気温・湿度計測

主な実装:

- [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:42)
- [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:143)
- [environment-store.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-store.ts:18)
- [jma-weather.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/jma-weather.ts:1)

---

## 全体フロー

`autonomous-action.sh` の中で `environment-tick.ts` が呼ばれ、次の順で観測を行う。

1. `ENVIRONMENT.md` の補助状態と、旧 JSON 状態ファイルを読む
2. CPU Core Max 温度を取得する
3. 温度 baseline を更新し、環境熱負荷 proxy を作る
4. WiFi カメラのナイトビジョンを OFF に固定し、ROI 輝度を取得する
5. 環境光を実輝度で正規化し、同時に相対評価用の輝度 baseline を更新する
6. 気象庁 AMeDAS から気温・湿度を取得する
7. 各観測値を `ENVIRONMENT.md` の現在値・補助状態・履歴へ保存する
8. 観測値を因果ランタイムへ渡し、`STATUS.md` の更新候補を作る
9. 因果ランタイムに失敗した場合だけ fallback ルールで `STATUS.md` を更新する
10. 旧 JSON 状態ファイルと persona structured store を同期する

実装上の入口は [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:457)。

---

## 保存モデル

環境観測の主な保存先は `ENVIRONMENT.md` である。

`ENVIRONMENT.md` には次の 3 種類の情報を保存する。

- `現在の環境`: 最新の観測値
- `補助状態`: baseline、サンプル数、ROI などの内部状態
- `変化履歴`: 観測ごとの履歴

フィールド定義は [environment-store.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-store.ts:18)。
書き込み処理は [setEnvironmentObservation()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-store.ts:392) と
[setEnvironmentAuxValue()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-store.ts:424)。

旧来の JSON 状態ファイル `.claude/workingDirs/environment-state.json` も、互換用に引き続き更新する。
ただし baseline や ROI の復元は `ENVIRONMENT.md` の補助状態が優先される。

---

## 温度計測

### データ源

- URL: `http://localhost:8085/data.json`
- 実装定数: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:43)
- 取得関数: `getCpuCoreMax()`

`getCpuCoreMax()` は Local Hardware Monitor 系の JSON から `Core Max`,
`Core (Tctl/Tdie)`, `CPU Package` のいずれかを探し、取得できなければ `null` を返す。

### baseline

温度 baseline は EMA で更新する。

- `TEMPERATURE_EMA_ALPHA = 0.2`
- 実装: [computeTemperatureBaseline()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:146)

式:

```text
nextBaseline = previousBaseline * 0.8 + currentTemp * 0.2
```

初回は `currentTemp` をそのまま baseline にする。

### 熱負荷 proxy

温度は絶対値ではなく、更新後 baseline との差で扱う。

```text
relativeDelta = nextBaseline - currentTemp
thermalLoad = clamp(round(50 - relativeDelta * 4), 0, 100)
```

意味:

- `currentTemp` が baseline より高い: `relativeDelta` は負、熱負荷は高くなる
- `currentTemp` が baseline より低い: `relativeDelta` は正、熱負荷は低くなる
- `40-60` 付近: 安定帯

`energy` fallback の変化量は次の式で作る。

```text
energyDelta = clamp(round(relativeDelta * 0.8), -8, +5)
```

`environment_thermal_load` は因果ランタイムにも渡される。
因果ランタイムが使えない場合は、`energy` と `health` の fallback 更新に使う。

---

## 明るさ計測

### データ源

- WiFi カメラの RTSP `stream2`
- 実装スクリプト: [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:143)
- 呼び出し元: [getRoomBrightness()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:431)

`environment-tick.ts` は `wifi-cam-mcp` ディレクトリを作業ディレクトリとして、次を実行する。

```bash
uv run python /home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py --roi <roiSpec>
```

`capture-brightness-wifi.py` は RTSP フレーム取得の直前に ONVIF の `IrCutFilter`
を `OFF` に設定する。これは環境光計測の前提条件であり、ナイトビジョンや赤外線補助で
夜の画像が明るく補正されると、朝/夜の実輝度差を測れなくなるためである。

`OFF` にできない場合は輝度値を返さず、呼び出し元は明るさ更新をスキップする。
不確かな輝度を `ambient_brightness` として保存しない。

### 輝度の求め方

ナイトビジョン OFF を確認したあと、`capture-brightness-wifi.py` は RTSP から
1 フレームだけ JPEG として取得し、
指定 ROI を切り出したあとグレースケール化して平均値を返す。

- ROI 検証: [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:54)
- ROI 切り出し: [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:78)
- 平均輝度: [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:184)

式としてはほぼ次と同じである。

```text
brightness = mean(grayscale(roi_pixels))
```

返り値は `0-255` の浮動小数点。

### 実輝度の正規化

現行実装では、`ambient_brightness.normalizedValue` は baseline 差分ではなく、
カメラ ROI の実輝度から直接 `0-100` に正規化する。

実装: [describeBrightnessObservation()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:277)

式:

```text
normalizedValue = clamp(round((brightness / 255) * 100), 0, 100)
```

この値が `ENVIRONMENT.md` の `環境光` 正規化値になり、因果ランタイムの
`ambient_brightness` 入力にもなる。

この設計の意図は、ナイトビジョンを常時 OFF にしたカメラ画像の実輝度で「夜 / 朝」を区別し、
夜の暗さを slow EMA baseline に吸収しないことである。

### baseline 相対値

輝度 baseline は引き続き EMA で更新するが、これは主観的な相対評価用であり、
夜/朝判定の本体ではない。

- `BRIGHTNESS_EMA_ALPHA = 0.1`
- 実装: [computeBrightnessBaseline()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:157)

式:

```text
nextBaseline = previousBaseline * 0.9 + currentBrightness * 0.1
```

初回は `currentBrightness` をそのまま baseline にする。

baseline 相対値は次の式で作り、reason 文字列に `baseline相対` として併記する。

```text
relativeNormalizedValue =
  clamp(round(50 + ((currentBrightness - baseline) / 60) * 50), 0, 100)
```

実装: [normalizeBrightnessAgainstBaseline()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:198)

### 明るさ帯域と mood fallback

`describeBrightnessObservation()` は、実輝度ベースの `normalizedValue` と
baseline 相対の `relativeNormalizedValue` から `bright / neutral / dim / dark` を決める。

現行の帯域:

- `normalizedValue >= 70`: `bright`
- `normalizedValue <= 20`: `dark`
- `normalizedValue <= 35`: `dim`
- 上記以外で `relativeNormalizedValue >= 75`: `bright`
- それ以外: `neutral`

つまり、暗さは必ず実輝度で判定する。
一方、実輝度は中間でも「いつもよりかなり明るい」場合だけ baseline 相対で `bright` にできる。

fallback の mood 変化:

- `bright`: `+2`
- `dark`: `-3`
- `dim` / `neutral`: `0`

因果ランタイムが正常に動いた場合は、fallback ではなく因果ランタイムの proposal が
`STATUS.md` 更新に使われる。

---

## ROI 仕様

### ROI の意味

ROI は `x,y,width,height` の 4 要素で表す矩形で、左上基準の normalized 座標である。

- `x`, `y`: 左上位置
- `width`, `height`: 矩形の幅と高さ
- 期待レンジ: `0.0` から `1.0`

Python 側の検証は [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:54)。

### ROI をどこで決めるか

ROI は Python スクリプトが自動抽出しているのではなく、
`environment-tick.ts` が決めて `--roi` 引数として渡す。

ROI の決定優先順位は次の通り。

1. 環境変数 `WARDROBE_BRIGHTNESS_ROI`
2. `ENVIRONMENT.md` 補助状態の `environment_brightness_roi`
3. 旧状態ファイル `environment-state.json` の `brightnessRoi`
4. デフォルト ROI

実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:481)

### デフォルト ROI

デフォルトは中央寄りの矩形である。

```text
x=0.20, y=0.20, width=0.60, height=0.60
```

実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:55)

つまり、特に設定がなければ「画面中央の 60% 四方」を明るさ測定に使う。

### TypeScript 側の ROI パース

`environment-tick.ts` 側の `parseBrightnessRoiSpec()` は、
値のどれかが `1` より大きい場合は `%` 指定とみなして 100 で割る。

例:

- `0.20,0.20,0.60,0.60`
- `20,20,60,60`

の両方を受けられる。

ただし Python 側は normalized 値しか受けない。
最終的には TypeScript 側が `toFixed(2)` で normalized 文字列へ整形してから渡すため、
Python に `%` 形式が直接届くことはない。

実装:

- パース: [parseBrightnessRoiSpec()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:168)
- 整形: [formatBrightnessRoiSpec()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:190)

### Python 側の ROI 切り出し

Python 側では normalized 値を画像のピクセル座標へ変換して crop する。

- `left = round(image_width * x)`
- `top = round(image_height * y)`
- `right = round(image_width * (x + width))`
- `bottom = round(image_height * (y + height))`

境界外にはみ出さないよう clamp し、最小 1px を保証する。

実装: [crop_to_roi()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:78)

---

## AMeDAS 気温・湿度

### データ源

`jma-weather.ts` は気象庁 AMeDAS の公開 JSON を読む。

- `latest_time.txt`: [jma-weather.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/jma-weather.ts:1)
- 観測所テーブル: [jma-weather.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/jma-weather.ts:2)
- map JSON: [fetchJmaWeatherSnapshot()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/jma-weather.ts:142)

観測所コードは `WARDROBE_JMA_AMEDAS_CODE` で指定できる。
未指定時は `44132`、観測所名は東京をデフォルトにする。

### 気温の正規化

気温は 22°C を中立付近として `0-100` に正規化する。

```text
ambient_temperature = clamp(round(50 + (tempCelsius - 22) * 4), 0, 100)
```

実装: [normalizeAmbientTemperature()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/jma-weather.ts:82)

`ambient_temperature` は `ENVIRONMENT.md` に保存され、因果ランタイムにも渡される。

### 湿度の正規化

湿度はほぼそのまま `0-100` に clamp する。

```text
ambient_humidity = clamp(round(humidityPercent), 0, 100)
```

実装: [describeAmbientHumidity()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/jma-weather.ts:113)

`ambient_humidity` も `ENVIRONMENT.md` に保存され、因果ランタイムに渡される。

---

## 因果ランタイムと STATUS.md 更新

`environment-tick.ts` は観測値を `causalInputs` に積み、
最後に `deriveEnvironmentCausalProposals()` へ渡す。

入力される source:

- `environment_thermal_load`
- `ambient_brightness`
- `ambient_temperature`
- `ambient_humidity`

因果ランタイムが正常に proposal を返した場合:

- proposal ごとに `STATUS.md` の `energy`, `mood`, `health` などを更新する
- proposal は causal runtime snapshot として保存される
- fallback ルールは使わない

因果ランタイムが失敗した場合:

- 温度由来の `energy` / `health` fallback
- 明るさ由来の `mood` fallback

を使う。

実装:

- causal runtime 呼び出し: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:681)
- fallback 適用: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:717)
- `STATUS.md` 更新: [updateStatus()](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:445)

---

## 保存される主な値

### ENVIRONMENT.md 現在値

- `environment_thermal_load`: CPU Core Max から作る熱負荷 proxy
- `ambient_brightness`: WiFi カメラ ROI の実輝度正規化値
- `ambient_temperature`: AMeDAS 気温
- `ambient_humidity`: AMeDAS 湿度

### ENVIRONMENT.md 補助状態

- `environment_thermal_baseline`
- `environment_sample_count`
- `environment_brightness_baseline`
- `environment_brightness_sample_count`
- `environment_brightness_roi`

`environment_brightness_baseline` は「ROI 輝度の slow EMA 基準値（相対評価用）」であり、
夜/朝判定の本体ではない。

### 旧 JSON 状態ファイル

互換・復元用に次の値も保存される。

- `energyTemperatureBaseline`
- `sampleCount`
- `brightnessBaseline`
- `brightnessSampleCount`
- `brightnessRoi`
- 直近観測値、直近 band、直近 reason

実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:575)

---

## 失敗時の扱い

- 温度取得失敗:
  - `LHM unavailable, skipping temperature` を出して温度系更新をスキップ
- 明るさ取得失敗:
  - `getRoomBrightness()` は `null` を返す
  - `Camera unavailable, skipping brightness` を出して明るさ系更新をスキップ
- AMeDAS 取得失敗:
  - `loadJmaWeatherObservationBundle()` がエラーメッセージを保持した bundle を返す
  - 気温・湿度更新をスキップし、他の観測は継続する
- 因果ランタイム失敗:
  - fallback ルールで `STATUS.md` 更新を試みる

このため、どれか 1 つのセンサーや外部データ源が落ちても、
`environment-tick.ts` 全体が即失敗する構成ではない。

---

## 現行実装上の注意

- 環境光は lux ではなく、カメラ画像上の ROI 平均輝度である
- ナイトビジョンを切った実輝度で夜/朝を区別する
- 輝度 baseline は相対評価用で、暗さそのものを baseline に吸収しない
- ROI は自動検出ではなく、固定矩形または保存済み矩形である
- 窓の白飛びや逆光の影響は ROI 設定次第で大きく変わる
- カメラ位置や画角を変えた場合、baseline は再学習されるが、実輝度正規化は即座に変わる
- `ENVIRONMENT.md` が主保存先で、旧 JSON 状態ファイルは互換用である
