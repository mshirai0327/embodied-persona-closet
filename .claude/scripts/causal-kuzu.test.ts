import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const ORIGINAL_SEED_PATH = process.env.WARDROBE_CAUSAL_SEED_PATH;
const ORIGINAL_LEARNED_PATH = process.env.WARDROBE_LEARNED_SEEDS_PATH;
const ORIGINAL_KUZU_DB_PATH = process.env.WARDROBE_PERSONA_KUZU_DB_PATH;
const kuzuTest = process.env.WARDROBE_RUN_KUZU_TESTS === "1" ? test : test.skip;

let tmpDirPath: string | null = null;

async function importTestModule() {
  return import(new URL(`./causal-kuzu.ts?test=${Date.now()}`, import.meta.url).href);
}

async function setupSeedGraph() {
  tmpDirPath = await mkdtemp(join(tmpdir(), "persona-kuzu-test-"));
  const seedPath = join(tmpDirPath, "causal-seeds.json");
  const learnedPath = join(tmpDirPath, "learned-seeds.json");
  const dbPath = join(tmpDirPath, "persona-causal.kuzu");

  await Bun.write(seedPath, JSON.stringify({
    nodes: [
      { id: "ambient_brightness", label: "環境光", kind: "environment", dataLevel: "Lv0", description: null },
      { id: "mood", label: "mood", kind: "emotion", dataLevel: "Lv3-2", description: null },
      { id: "social_openness", label: "social_openness", kind: "outcome", dataLevel: null, description: null },
      { id: "action_threshold", label: "action_threshold", kind: "action", dataLevel: null, description: null },
    ],
    edges: [
      {
        source: "ambient_brightness",
        target: "mood",
        relation: "lifts",
        causalLevel: "Lv1",
        weight: 0.7,
        description: null,
      },
      {
        source: "mood",
        target: "social_openness",
        relation: "raises",
        causalLevel: "Lv2",
        weight: 0.8,
        description: null,
      },
      {
        source: "social_openness",
        target: "action_threshold",
        relation: "lowers",
        causalLevel: "Lv3",
        weight: 0.5,
        description: null,
      },
    ],
  }, null, 2));
  await Bun.write(learnedPath, JSON.stringify({ learnedEdges: [] }, null, 2));

  process.env.WARDROBE_CAUSAL_SEED_PATH = seedPath;
  process.env.WARDROBE_LEARNED_SEEDS_PATH = learnedPath;
  process.env.WARDROBE_PERSONA_KUZU_DB_PATH = dbPath;

  return importTestModule();
}

afterEach(async () => {
  if (ORIGINAL_SEED_PATH == null) {
    delete process.env.WARDROBE_CAUSAL_SEED_PATH;
  } else {
    process.env.WARDROBE_CAUSAL_SEED_PATH = ORIGINAL_SEED_PATH;
  }

  if (ORIGINAL_LEARNED_PATH == null) {
    delete process.env.WARDROBE_LEARNED_SEEDS_PATH;
  } else {
    process.env.WARDROBE_LEARNED_SEEDS_PATH = ORIGINAL_LEARNED_PATH;
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

describe("causal-kuzu", () => {
  kuzuTest("syncs seed nodes and edges into a temp kuzu database and reads recursive paths", async () => {
    const module = await setupSeedGraph();

    await module.syncKuzuCausalGraph();
    const snapshot = await module.readKuzuCausalGraphSnapshot();
    const moodNode = await module.readKuzuCausalNode("mood");
    const upstream = await module.readKuzuCausalPathRows("social_openness", "upstream", 3);
    const downstream = await module.readKuzuCausalPathRows("mood", "downstream", 3);

    expect(snapshot.nodes).toHaveLength(4);
    expect(snapshot.edges).toHaveLength(3);
    expect(moodNode?.label).toBe("mood");
    expect(snapshot.edges.find((edge: { sourceId: string; targetId: string }) => (
      edge.sourceId === "mood" && edge.targetId === "social_openness"
    ))).toBeTruthy();

    expect(upstream.map((row: { terminalId: string }) => row.terminalId).sort()).toEqual([
      "ambient_brightness",
      "mood",
    ]);
    expect(
      upstream.find((row: { terminalId: string; middleNodeIds: string[] }) => row.terminalId === "ambient_brightness")
        ?.middleNodeIds
    ).toEqual(["mood"]);

    expect(downstream.map((row: { terminalId: string }) => row.terminalId).sort()).toEqual([
      "action_threshold",
      "social_openness",
    ]);
    expect(
      downstream.find((row: { terminalId: string; middleNodeIds: string[] }) => row.terminalId === "action_threshold")
        ?.middleNodeIds
    ).toEqual(["social_openness"]);
  }, 15000);
});
