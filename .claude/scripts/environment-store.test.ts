import { rm } from "node:fs/promises";

import { afterEach, describe, expect, test } from "bun:test";

import {
  parseEnvironmentDocument,
  readEnvironmentDocument,
  setEnvironmentAuxValue,
  setEnvironmentObservation,
} from "./environment-store";

const TMP_ENVIRONMENT_PATH = `${import.meta.dir}/../../tmp/environment-store.test.md`;

const ENVIRONMENT_SAMPLE = `# ENVIRONMENT.md — 環境データ

## 現在の環境

| 項目 | 生値 | 正規化値 | 最終更新 | 取得方法 | 根拠 |
|---|---|---|---|---|---|
| 環境熱負荷 proxy | 81.0 °C | 80 | 2026-04-13 12:00 | LHM/Core Max | 熱がかなりこもっている。 |
| 環境光 | 191 / 255 | 75 | 2026-04-13 12:00 | usb-webcam brightness | かなり明るい空間。 |
| 気温 | 22.4 °C | 52 | 2026-04-13 12:00 | JMA/AMeDAS | 気象庁アメダス 東京 22.4°C——過ごしやすい温度。 |
| 湿度 | 61 % | 61 | 2026-04-13 12:00 | JMA/AMeDAS | 気象庁アメダス 東京 湿度61%——少ししっとりしている。 |

## 補助状態

| 項目 | 値 | 最終更新 | 備考 |
|---|---|---|---|
| 熱負荷 baseline | 73.4 °C | 2026-04-13 12:00 | Core Max の EMA 基準値 |
| 観測サンプル数 | 12 | 2026-04-13 12:00 | baseline 算出に使ったサンプル数 |

## 変化履歴

| 日時 | 項目 | 変化前 | 変化後 | 正規化値 | 理由 |
|---|---|---|---|---|---|
| 2026-04-13 12:00 | 環境熱負荷 proxy | 76.0 °C | 81.0 °C | 80 | 熱がかなりこもっている。 |
`;

afterEach(async () => {
  await rm(TMP_ENVIRONMENT_PATH, { force: true });
});

describe("parseEnvironmentDocument", () => {
  test("extracts current rows, auxiliary state, and history", () => {
    const parsed = parseEnvironmentDocument(ENVIRONMENT_SAMPLE);

    expect(parsed.current.environment_thermal_load?.normalizedValue).toBe(80);
    expect(parsed.current.ambient_brightness?.rawValueText).toBe("191 / 255");
    expect(parsed.current.ambient_temperature?.rawValueText).toBe("22.4 °C");
    expect(parsed.current.ambient_humidity?.normalizedValue).toBe(61);
    expect(parsed.aux.environment_thermal_baseline?.valueText).toBe("73.4 °C");
    expect(parsed.aux.environment_sample_count?.valueText).toBe("12");
    expect(parsed.history[0]?.key).toBe("environment_thermal_load");
    expect(parsed.history[0]?.normalizedValue).toBe(80);
  });
});

describe("environment markdown updates", () => {
  test("writes current observations and auxiliary state", async () => {
    await Bun.write(TMP_ENVIRONMENT_PATH, ENVIRONMENT_SAMPLE);

    await setEnvironmentObservation(
      "ambient_brightness",
      "44 / 255",
      17,
      {
        environmentPath: TMP_ENVIRONMENT_PATH,
        reason: "環境光 17/100（輝度44/255）——かなり暗い。",
        source: "usb-webcam brightness",
        recordHistoryOnUnchanged: true,
      }
    );
    await setEnvironmentAuxValue(
      "environment_sample_count",
      "13",
      {
        environmentPath: TMP_ENVIRONMENT_PATH,
        note: "baseline 算出に使ったサンプル数",
      }
    );

    const parsed = await readEnvironmentDocument(TMP_ENVIRONMENT_PATH);
    expect(parsed?.current.ambient_brightness?.normalizedValue).toBe(17);
    expect(parsed?.aux.environment_sample_count?.valueText).toBe("13");
    expect(parsed?.history[0]?.key).toBe("ambient_brightness");
  });
});
