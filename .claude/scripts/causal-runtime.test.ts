import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const ORIGINAL_SEED_PATH = process.env.WARDROBE_CAUSAL_SEED_PATH;
const ORIGINAL_KUZU_DB_PATH = process.env.WARDROBE_PERSONA_KUZU_DB_PATH;
const kuzuTest = process.env.WARDROBE_RUN_KUZU_TESTS === "1" ? test : test.skip;

let tmpDirPath: string | null = null;

async function importRuntimeModule() {
  return import(new URL(`./causal-runtime.ts?test=${Date.now()}`, import.meta.url).href);
}

async function setupSeedGraph() {
  tmpDirPath = await mkdtemp(join(tmpdir(), "persona-causal-runtime-test-"));
  const seedPath = join(tmpDirPath, "causal-seeds.json");
  const dbPath = join(tmpDirPath, "persona-causal.kuzu");

  await Bun.write(seedPath, JSON.stringify({
    nodes: [
      { id: "ambient_brightness", label: "環境光", kind: "environment", dataLevel: "Lv0", description: null },
      { id: "environment_thermal_load", label: "環境熱負荷 proxy", kind: "environment", dataLevel: "Lv0", description: null },
      { id: "ambient_temperature", label: "気温", kind: "environment", dataLevel: "Lv0", description: null },
      { id: "ambient_humidity", label: "湿度", kind: "environment", dataLevel: "Lv0", description: null },
      { id: "mood", label: "mood", kind: "emotion", dataLevel: "Lv3-2", description: null },
      { id: "energy", label: "energy", kind: "emotion", dataLevel: "Lv3-2", description: null },
      { id: "health", label: "health", kind: "emotion", dataLevel: "Lv3-2", description: null },
    ],
    edges: [
      {
        source: "ambient_brightness",
        target: "mood",
        relation: "lifts",
        causalLevel: "Lv1",
        weight: 0.76,
        description: null,
      },
      {
        source: "environment_thermal_load",
        target: "energy",
        relation: "drains",
        causalLevel: "Lv1",
        weight: 0.88,
        description: null,
      },
      {
        source: "environment_thermal_load",
        target: "health",
        relation: "pressures",
        causalLevel: "Lv1",
        weight: 0.69,
        description: null,
      },
      {
        source: "environment_thermal_load",
        target: "ambient_temperature",
        relation: "proxies",
        causalLevel: "Lv2",
        weight: 0.55,
        description: null,
      },
      {
        source: "ambient_temperature",
        target: "energy",
        relation: "drains",
        causalLevel: "Lv1",
        weight: 0.58,
        description: null,
      },
      {
        source: "ambient_temperature",
        target: "health",
        relation: "pressures",
        causalLevel: "Lv1",
        weight: 0.63,
        description: null,
      },
      {
        source: "ambient_humidity",
        target: "energy",
        relation: "drains",
        causalLevel: "Lv1",
        weight: 0.52,
        description: null,
      },
      {
        source: "ambient_humidity",
        target: "mood",
        relation: "drains",
        causalLevel: "Lv1",
        weight: 0.40,
        description: null,
      },
      {
        source: "ambient_humidity",
        target: "health",
        relation: "pressures",
        causalLevel: "Lv1",
        weight: 0.38,
        description: null,
      },
    ],
  }, null, 2));

  process.env.WARDROBE_CAUSAL_SEED_PATH = seedPath;
  process.env.WARDROBE_PERSONA_KUZU_DB_PATH = dbPath;

  return importRuntimeModule();
}

afterEach(async () => {
  if (ORIGINAL_SEED_PATH == null) {
    delete process.env.WARDROBE_CAUSAL_SEED_PATH;
  } else {
    process.env.WARDROBE_CAUSAL_SEED_PATH = ORIGINAL_SEED_PATH;
  }

  if (ORIGINAL_KUZU_DB_PATH == null) {
    delete process.env.WARDROBE_PERSONA_KUZU_DB_PATH;
  } else {
    process.env.WARDROBE_PERSONA_KUZU_DB_PATH = ORIGINAL_KUZU_DB_PATH;
  }

  if (tmpDirPath) {
    await rm(tmpDirPath, { recursive: true, force: true });
    tmpDirPath = null;
  }
});

describe("causal-runtime", () => {
  test("normalizes each source with its own neutral band", async () => {
    const module = await setupSeedGraph();

    expect(module.normalizeCausalActivation("ambient_brightness", 0)).toBe(-1);
    expect(module.normalizeCausalActivation("ambient_brightness", 45)).toBe(0);
    expect(module.normalizeCausalActivation("ambient_brightness", 90)).toBeGreaterThan(0);

    expect(module.normalizeCausalActivation("environment_thermal_load", 20)).toBeLessThan(0);
    expect(module.normalizeCausalActivation("environment_thermal_load", 45)).toBeCloseTo(0, 10);
    expect(module.normalizeCausalActivation("environment_thermal_load", 85)).toBeGreaterThan(0);

    expect(module.normalizeCausalActivation("ambient_temperature", 44)).toBe(0);
    expect(module.normalizeCausalActivation("ambient_temperature", 85)).toBeGreaterThan(0);

    expect(module.normalizeCausalActivation("ambient_humidity", 60)).toBe(0);
    expect(module.normalizeCausalActivation("ambient_humidity", 85)).toBeGreaterThan(0);
  });

  test("treats modulates as direction-agnostic in phase 1 scoring", async () => {
    const module = await setupSeedGraph();

    expect(module.getPhase1RelationSign("modulates")).toBe(0);
    expect(module.computeCausalPathScore(0.6, {
      relations: ["modulates"],
      weights: [0.82],
    })).toBe(0);
  });

  kuzuTest("maps bright environments to a positive mood proposal", async () => {
    const module = await setupSeedGraph();

    const proposals = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "ambient_brightness",
        normalizedValue: 90,
        reason: "環境光 90/100",
      },
    ]);

    const mood = proposals.find((proposal: { field: string }) => proposal.field === "mood");
    expect(mood).toBeTruthy();
    expect(mood?.delta).toBeGreaterThan(0);
    expect(mood?.topPathDescription).toContain("環境光");
  }, 15000);

  kuzuTest("maps high thermal load to negative energy and health proposals", async () => {
    const module = await setupSeedGraph();

    const proposals = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "environment_thermal_load",
        normalizedValue: 85,
        reason: "環境熱負荷 proxy 85/100",
      },
    ]);

    const energy = proposals.find((proposal: { field: string }) => proposal.field === "energy");
    const health = proposals.find((proposal: { field: string }) => proposal.field === "health");

    expect(energy).toBeTruthy();
    expect(health).toBeTruthy();
    expect(energy?.delta).toBeLessThan(0);
    expect(health?.delta).toBeLessThan(0);
  }, 15000);

  kuzuTest("maps low thermal load to recovery-oriented energy and health proposals", async () => {
    const module = await setupSeedGraph();

    const proposals = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "environment_thermal_load",
        normalizedValue: 20,
        reason: "環境熱負荷 proxy 20/100",
      },
    ]);

    const energy = proposals.find((proposal: { field: string }) => proposal.field === "energy");
    const health = proposals.find((proposal: { field: string }) => proposal.field === "health");

    expect(energy).toBeTruthy();
    expect(health).toBeTruthy();
    expect(energy?.delta).toBeGreaterThan(0);
    expect(health?.delta).toBeGreaterThan(0);
  }, 15000);

  kuzuTest("does not keep nudging status when brightness and thermal load stay in the neutral band", async () => {
    const module = await setupSeedGraph();

    const proposals = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "ambient_brightness",
        normalizedValue: 45,
        reason: "環境光 45/100",
      },
      {
        sourceId: "environment_thermal_load",
        normalizedValue: 45,
        reason: "環境熱負荷 proxy 45/100",
      },
    ]);

    expect(proposals).toEqual([]);
  }, 15000);

  kuzuTest("does not treat comfortable temperature and moderate humidity as automatic recovery", async () => {
    const module = await setupSeedGraph();

    const proposals = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "ambient_temperature",
        normalizedValue: 44,
        reason: "気温 44/100",
      },
      {
        sourceId: "ambient_humidity",
        normalizedValue: 60,
        reason: "湿度 60/100",
      },
    ]);

    expect(proposals).toEqual([]);
  }, 15000);

  kuzuTest("adds a hot-and-humid interaction load on top of direct temperature and humidity effects", async () => {
    const module = await setupSeedGraph();

    const temperatureOnly = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "ambient_temperature",
        normalizedValue: 85,
        reason: "気温 85/100",
      },
    ]);
    const humidityOnly = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "ambient_humidity",
        normalizedValue: 85,
        reason: "湿度 85/100",
      },
    ]);
    const combined = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "ambient_temperature",
        normalizedValue: 85,
        reason: "気温 85/100",
      },
      {
        sourceId: "ambient_humidity",
        normalizedValue: 85,
        reason: "湿度 85/100",
      },
    ]);

    const temperatureEnergy = temperatureOnly.find((proposal: { field: string }) => proposal.field === "energy");
    const humidityEnergy = humidityOnly.find((proposal: { field: string }) => proposal.field === "energy");
    const combinedEnergy = combined.find((proposal: { field: string }) => proposal.field === "energy");
    const temperatureHealth = temperatureOnly.find((proposal: { field: string }) => proposal.field === "health");
    const combinedHealth = combined.find((proposal: { field: string }) => proposal.field === "health");

    expect(temperatureEnergy).toBeTruthy();
    expect(humidityEnergy).toBeTruthy();
    expect(combinedEnergy).toBeTruthy();
    expect(temperatureHealth).toBeTruthy();
    expect(combinedHealth).toBeTruthy();
    expect(combinedEnergy?.score).toBeLessThan((temperatureEnergy?.score ?? 0) + (humidityEnergy?.score ?? 0));
    expect(combinedHealth?.score).toBeLessThan(temperatureHealth?.score ?? 0);
    expect(combinedHealth?.contributingSources).toContain("ambient_temperature");
    expect(combinedHealth?.contributingSources).toContain("ambient_humidity");
  }, 15000);

  kuzuTest("does not apply the weather interaction when only temperature is present", async () => {
    const module = await setupSeedGraph();

    const proposals = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "ambient_temperature",
        normalizedValue: 85,
        reason: "気温 85/100",
      },
    ]);

    const energy = proposals.find((proposal: { field: string }) => proposal.field === "energy");
    const health = proposals.find((proposal: { field: string }) => proposal.field === "health");

    expect(energy).toBeTruthy();
    expect(health).toBeTruthy();
    expect(energy?.score).toBeCloseTo(-0.331, 3);
    expect(health?.score).toBeCloseTo(-0.360, 3);
    expect(health?.contributingSources).toEqual(["ambient_temperature"]);
  }, 15000);

  kuzuTest("maps high humidity to negative mood, energy, and health proposals", async () => {
    const module = await setupSeedGraph();

    const proposals = await module.deriveEnvironmentCausalProposals([
      {
        sourceId: "ambient_humidity",
        normalizedValue: 85,
        reason: "湿度 85/100",
      },
    ]);

    const mood = proposals.find((proposal: { field: string }) => proposal.field === "mood");
    const energy = proposals.find((proposal: { field: string }) => proposal.field === "energy");
    const health = proposals.find((proposal: { field: string }) => proposal.field === "health");

    expect(mood).toBeTruthy();
    expect(energy).toBeTruthy();
    expect(health).toBeTruthy();
    expect(mood?.delta).toBeLessThan(0);
    expect(energy?.delta).toBeLessThan(0);
    expect(health?.delta).toBeLessThanOrEqual(0);
    expect(health?.contributingSources).toEqual(["ambient_humidity"]);
  }, 15000);
});
