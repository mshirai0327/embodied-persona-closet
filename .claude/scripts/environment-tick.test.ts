import { describe, expect, test } from "bun:test";

import {
  computeBrightnessBaseline,
  formatBrightnessRoiSpec,
  computeTemperatureBaseline,
  describeBrightnessObservation,
  evaluateEnergyFromTemperature,
  evaluateHealthFromThermalLoad,
  evaluateMoodFromBrightness,
  evaluateThermalLoadProxy,
  loadJmaWeatherObservationBundle,
  parseBrightnessRoiSpec,
} from "./environment-tick.ts";

describe("computeTemperatureBaseline", () => {
  test("uses current temperature for first sample", () => {
    expect(computeTemperatureBaseline(undefined, 100)).toBe(100);
    expect(computeTemperatureBaseline(null, 87)).toBe(87);
  });

  test("applies EMA to existing baseline", () => {
    expect(computeTemperatureBaseline(100, 90)).toBeCloseTo(98, 5);
    expect(computeTemperatureBaseline(80, 100)).toBeCloseTo(84, 5);
  });
});

describe("computeBrightnessBaseline", () => {
  test("uses current brightness for first sample", () => {
    expect(computeBrightnessBaseline(undefined, 96)).toBe(96);
    expect(computeBrightnessBaseline(null, 84)).toBe(84);
  });

  test("applies a slow EMA to the saved baseline", () => {
    expect(computeBrightnessBaseline(100, 40)).toBeCloseTo(94, 5);
    expect(computeBrightnessBaseline(60, 120)).toBeCloseTo(66, 5);
  });
});

describe("evaluateEnergyFromTemperature", () => {
  test("does not change energy on the first sample", () => {
    const result = evaluateEnergyFromTemperature(100, undefined);

    expect(result.previousBaseline).toBeNull();
    expect(result.nextBaseline).toBe(100);
    expect(result.relativeDelta).toBe(0);
    expect(result.energyDelta).toBe(0);
  });

  test("recovers when current temperature is cooler than the baseline", () => {
    const result = evaluateEnergyFromTemperature(90, 100);

    expect(result.nextBaseline).toBeCloseTo(98, 5);
    expect(result.relativeDelta).toBeCloseTo(8, 5);
    expect(result.energyDelta).toBe(5);
    expect(result.reason).toContain("回復");
  });

  test("consumes energy when current temperature is hotter than the baseline", () => {
    const result = evaluateEnergyFromTemperature(110, 100);

    expect(result.nextBaseline).toBeCloseTo(102, 5);
    expect(result.relativeDelta).toBeCloseTo(-8, 5);
    expect(result.energyDelta).toBe(-6);
    expect(result.reason).toContain("消耗");
  });

  test("stays near zero around the personal baseline", () => {
    const result = evaluateEnergyFromTemperature(100, 100);

    expect(result.energyDelta).toBe(0);
    expect(result.reason).toContain("安定");
  });
});

describe("evaluateThermalLoadProxy", () => {
  test("maps hotter-than-baseline states to a high thermal load score", () => {
    const proxy = evaluateThermalLoadProxy(110, {
      nextBaseline: 102,
      relativeDelta: -8,
    });

    expect(proxy.normalizedValue).toBeGreaterThan(75);
    expect(proxy.band).toBe("hot");
  });
});

describe("describeBrightnessObservation", () => {
  test("records absolute brightness separately from the saved placement baseline", () => {
    const observation = describeBrightnessObservation(191, {
      baseline: 191,
      roiSpec: "0.20,0.20,0.60,0.60",
    });

    expect(observation.normalizedValue).toBe(75);
    expect(observation.relativeNormalizedValue).toBe(50);
    expect(observation.band).toBe("bright");
    expect(observation.reason).toContain("環境光");
    expect(observation.reason).toContain("baseline相対 50/100");
    expect(observation.reason).toContain("ROI 0.20,0.20,0.60,0.60");
  });

  test("keeps night dark even when the saved baseline has followed the room darkness", () => {
    const observation = describeBrightnessObservation(8, {
      baseline: 8,
      roiSpec: "0.20,0.20,0.60,0.60",
    });

    expect(observation.normalizedValue).toBe(3);
    expect(observation.relativeNormalizedValue).toBe(50);
    expect(observation.band).toBe("dark");
  });

  test("keeps morning brightness distinguishable from night even near the saved baseline", () => {
    const observation = describeBrightnessObservation(110, {
      baseline: 110,
      roiSpec: "0.20,0.20,0.60,0.60",
    });

    expect(observation.normalizedValue).toBe(43);
    expect(observation.relativeNormalizedValue).toBe(50);
    expect(observation.band).toBe("neutral");
  });

  test("treats a scene as dark when the absolute camera brightness is low", () => {
    const observation = describeBrightnessObservation(44, {
      baseline: 96,
      roiSpec: "0.20,0.20,0.60,0.60",
    });

    expect(observation.normalizedValue).toBeLessThan(20);
    expect(observation.band).toBe("dark");
  });
});

describe("evaluateMoodFromBrightness", () => {
  test("lifts mood when brightness is well above the calibrated baseline", () => {
    const result = evaluateMoodFromBrightness(
      180,
      describeBrightnessObservation(180, { baseline: 110 }),
    );

    expect(result.moodDelta).toBe(2);
  });

  test("penalizes mood when brightness is well below the calibrated baseline", () => {
    const result = evaluateMoodFromBrightness(
      30,
      describeBrightnessObservation(30, { baseline: 100 }),
    );

    expect(result.moodDelta).toBe(-3);
  });
});

describe("brightness ROI helpers", () => {
  test("parses normalized ROI specs", () => {
    expect(parseBrightnessRoiSpec("0.20,0.20,0.60,0.60")).toEqual({
      x: 0.2,
      y: 0.2,
      width: 0.6,
      height: 0.6,
    });
  });

  test("formats ROI specs in a stable way", () => {
    expect(formatBrightnessRoiSpec({
      x: 0.2,
      y: 0.2,
      width: 0.6,
      height: 0.6,
    })).toBe("0.20,0.20,0.60,0.60");
  });
});

describe("evaluateHealthFromThermalLoad", () => {
  test("penalizes health when thermal load is high", () => {
    const result = evaluateHealthFromThermalLoad(85, "環境熱負荷 proxy 85/100");

    expect(result.healthDelta).toBeLessThan(0);
    expect(result.reason).toContain("健康感");
  });

  test("supports health when thermal load is light", () => {
    const result = evaluateHealthFromThermalLoad(20, "環境熱負荷 proxy 20/100");

    expect(result.healthDelta).toBeGreaterThan(0);
    expect(result.reason).toContain("健康感");
  });
});

describe("loadJmaWeatherObservationBundle", () => {
  test("builds causal inputs from JMA temperature and humidity", async () => {
    const result = await loadJmaWeatherObservationBundle(async () => ({
      observedAt: "2026-04-18T21:00:00+09:00",
      stationCode: "44132",
      stationName: "東京",
      temperature: {
        rawValue: 28.4,
        normalizedValue: 76,
        reason: "気象庁アメダス 東京 28.4°C——少し暑い。",
        source: "JMA/AMeDAS",
        stationName: "東京",
        observedAt: "2026-04-18T21:00:00+09:00",
      },
      humidity: {
        rawValue: 78,
        normalizedValue: 78,
        reason: "気象庁アメダス 東京 湿度78%——少し蒸す。",
        source: "JMA/AMeDAS",
        stationName: "東京",
        observedAt: "2026-04-18T21:00:00+09:00",
      },
    }));

    expect(result.errorMessage).toBeNull();
    expect(result.weather?.stationName).toBe("東京");
    expect(result.causalInputs).toEqual([
      {
        sourceId: "ambient_temperature",
        normalizedValue: 76,
        reason: "気象庁アメダス 東京 28.4°C——少し暑い。",
      },
      {
        sourceId: "ambient_humidity",
        normalizedValue: 78,
        reason: "気象庁アメダス 東京 湿度78%——少し蒸す。",
      },
    ]);
  });

  test("returns no JMA causal inputs when weather fetch fails so fallback can continue", async () => {
    const result = await loadJmaWeatherObservationBundle(async () => {
      throw new Error("network down");
    });

    expect(result.weather).toBeNull();
    expect(result.causalInputs).toEqual([]);
    expect(result.errorMessage).toContain("network down");
  });
});
