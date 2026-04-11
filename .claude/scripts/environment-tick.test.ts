import { describe, expect, test } from "bun:test";

import {
  computeTemperatureBaseline,
  evaluateEnergyFromTemperature,
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
    expect(result.reason).toContain("通常温度");
  });
});
