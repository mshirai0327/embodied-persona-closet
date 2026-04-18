import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const ORIGINAL_SEED_PATH = process.env.WARDROBE_CAUSAL_SEED_PATH;
const ORIGINAL_KUZU_DB_PATH = process.env.WARDROBE_PERSONA_KUZU_DB_PATH;

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
        target: "health",
        relation: "pressures",
        causalLevel: "Lv1",
        weight: 0.63,
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
  test("normalizes source activation into the -1..1 range", async () => {
    const module = await setupSeedGraph();

    expect(module.normalizeCausalActivation(0)).toBe(-1);
    expect(module.normalizeCausalActivation(50)).toBe(0);
    expect(module.normalizeCausalActivation(75)).toBeCloseTo(0.5, 5);
    expect(module.normalizeCausalActivation(100)).toBe(1);
  });

  test("treats modulates as direction-agnostic in phase 1 scoring", async () => {
    const module = await setupSeedGraph();

    expect(module.getPhase1RelationSign("modulates")).toBe(0);
    expect(module.computeCausalPathScore(0.6, {
      relations: ["modulates"],
      weights: [0.82],
    })).toBe(0);
  });

  test("maps bright environments to a positive mood proposal", async () => {
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

  test("maps high thermal load to negative energy and health proposals", async () => {
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

  test("maps low thermal load to recovery-oriented energy and health proposals", async () => {
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
});
