# 環境データ計測仕様メモ

## 概要

この文書は、2026-04-24 時点の実装に基づく `environment-tick.ts` 周辺の
環境データ計測仕様メモである。

- 対象:
  - CPU 温度からの環境熱負荷 proxy 計測
  - WiFi カメラ画像からの環境光計測
- 主な実装:
  - `.claude/scripts/environment-tick.ts`
  - `.claude/scripts/capture-brightness-wifi.py`
  - `.claude/scripts/environment-store.ts`

---

## 全体フロー

`autonomous-action.sh` の中で `environment-tick.ts` が呼ばれ、次の順で観測を行う。

1. CPU 温度を取得する
2. 温度 baseline を更新する
3. 熱負荷 proxy を求め、`energy` と `health` の更新候補を作る
4. WiFi カメラから ROI 輝度を取得する
5. 輝度 baseline を更新する
6. 環境光観測値を `mood` の更新候補に変換する
7. 補助情報を `STATUS.md` の aux フィールドへ保存する

実装上の入口は [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:446)。

---

## 温度計測

### データ源

- URL: `http://localhost:8085/data.json`
- 実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:43)
- 取得関数: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:393)

`getCpuCoreMax()` は Local Hardware Monitor 系の JSON から CPU Core Max を読み、
取得できなければ `null` を返す。

### baseline

温度 baseline は EMA で更新する。

- `TEMPERATURE_EMA_ALPHA = 0.2`
- 実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:49)
- 計算: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:145)

式:

```text
nextBaseline = previousBaseline * 0.8 + currentTemp * 0.2
```

初回は `currentTemp` をそのまま baseline にする。

### 評価

温度は絶対値ではなく baseline との差で扱う。

- 評価関数: `evaluateEnergyFromTemperature()`
- 実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:239)

この結果から:

- `energy` 向けの変化量
- `environment_thermal_load` という normalized な proxy
- `health` 向けの補助評価

を作る。

---

## 明るさ計測

### データ源

- WiFi カメラの RTSP `stream2`
- 実装スクリプト: [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:82)
- 呼び出し元: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:420)

`environment-tick.ts` は次を実行する。

```bash
uv run python .claude/scripts/capture-brightness-wifi.py --roi <roiSpec>
```

作業ディレクトリは `wifi-cam-mcp` ディレクトリである。
[environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:422)

### 輝度の求め方

`capture-brightness-wifi.py` は 1 フレームだけ JPEG として取得し、
指定 ROI を切り出したあとグレースケール化して平均値を返す。

- ROI 切り出し: [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:69)
- 平均輝度: [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:119)

式としてはほぼ次と同じである。

```text
brightness = mean(grayscale(roi_pixels))
```

返り値は `0-255` の浮動小数点。

### baseline

輝度 baseline も EMA で更新する。

- `BRIGHTNESS_EMA_ALPHA = 0.1`
- 実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:50)
- 計算: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:156)

式:

```text
nextBaseline = previousBaseline * 0.9 + currentBrightness * 0.1
```

初回は `currentBrightness` をそのまま baseline にする。

### 正規化と mood への反映

明るさは固定閾値ではなく baseline との差で `0-100` に正規化する。

- 実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:197)
- 観測記述: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:272)

式:

```text
normalized = clamp(round(50 + ((currentBrightness - baseline) / 60) * 50), 0, 100)
```

その後 `bright / neutral / dim / dark` の帯域へ落とし込み、
`mood` の更新候補を作る。

なお実装上は `describeBrightnessObservation()` に渡す baseline として
更新後の `nextBrightnessBaseline` を使っている。
[environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:554)

---

## ROI 仕様

### ROI の意味

ROI は `x,y,width,height` の 4 要素で表す矩形で、左上基準の normalized 座標である。

- `x`, `y`: 左上位置
- `width`, `height`: 矩形の幅と高さ
- 期待レンジ: `0.0` から `1.0`

Python 側の厳密な検証は [capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:45)。

### ROI をどこで決めるか

ROI は Python スクリプトが自動抽出しているのではなく、
`environment-tick.ts` が決めて `--roi` 引数として渡す。

ROI の決定優先順位は次の通り。

1. 環境変数 `WARDROBE_BRIGHTNESS_ROI`
2. `STATUS.md` aux フィールドの `environment_brightness_roi`
3. 旧状態ファイル `environment-state.json` の `brightnessRoi`
4. デフォルト ROI

実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:470)

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
[environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:167)

ただし Python 側は normalized 値しか受けない。
最終的には TypeScript 側が `toFixed(2)` で normalized 文字列へ整形してから渡すため、
Python に `%` 形式が直接届くことはない。
[environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:189)

### Python 側の ROI 切り出し

Python 側では normalized 値を画像のピクセル座標へ変換して crop する。

- `left = round(image_width * x)`
- `top = round(image_height * y)`
- `right = round(image_width * (x + width))`
- `bottom = round(image_height * (y + height))`

境界外にはみ出さないよう clamp し、最小 1px を保証する。
[capture-brightness-wifi.py](/home/mizuho/develop/embodied-reflecta/.claude/scripts/capture-brightness-wifi.py:73)

---

## 保存先

明るさ観測の補助情報は `STATUS.md` aux フィールドへ保存される。

- `environment_brightness_baseline`
- `environment_brightness_sample_count`
- `environment_brightness_roi`

フィールド定義: [environment-store.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-store.ts:50)
書き込み: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:587)

旧来の JSON 状態ファイルにも次が保存される。

- `brightnessBaseline`
- `brightnessSampleCount`
- `brightnessRoi`

実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:564)

---

## 失敗時の扱い

- 温度取得失敗:
  - `LHM unavailable, skipping temperature` を出して温度系更新をスキップ
  - 実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:547)
- 明るさ取得失敗:
  - `getRoomBrightness()` は `null` を返す
  - 明るさ系更新をスキップ
  - 実装: [environment-tick.ts](/home/mizuho/develop/embodied-reflecta/.claude/scripts/environment-tick.ts:427)

このため、どちらかのセンサーが落ちても `environment-tick.ts` 全体が即失敗する構成ではない。

---

## 現行実装上の注意

- ROI は自動検出ではなく、固定矩形または保存済み矩形である
- 窓の白飛びや逆光の影響は ROI 設定次第で大きく変わる
- 明るさ評価は absolute な lux ではなく、カメラ画像上の相対的な平均輝度である
- mood 反映は baseline との差分依存なので、カメラ位置変更後は baseline が再学習される
