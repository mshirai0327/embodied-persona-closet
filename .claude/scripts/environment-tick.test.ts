import { describe, expect, test } from "bun:test";

import {
  computeTemperatureBaseline,
  describeBrightnessObservation,
  evaluateEnergyFromTemperature,
  evaluateHealthFromThermalLoad,
  evaluateMoodFromBrightness,
  evaluateThermalLoadProxy,
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
  test("normalizes camera brightness into an environment score", () => {
    const observation = describeBrightnessObservation(191);

    expect(observation.normalizedValue).toBe(75);
    expect(observation.band).toBe("bright");
    expect(observation.reason).toContain("環境光");
  });
});

describe("evaluateMoodFromBrightness", () => {
  test("keeps the legacy bright-room uplift", () => {
    const result = evaluateMoodFromBrightness(180);

    expect(result.moodDelta).toBe(2);
  });

  test("keeps the legacy dark-room penalty", () => {
    const result = evaluateMoodFromBrightness(30);

    expect(result.moodDelta).toBe(-3);
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
