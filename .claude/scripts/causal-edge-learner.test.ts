import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";

const ORIGINAL_MEMORY_DB_PATH = process.env.MEMORY_DB_PATH;
const ORIGINAL_PENDING_LEARNED_EDGES_PATH = process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH;
const ORIGINAL_CAUSAL_RUNTIME_PATH = process.env.WARDROBE_CAUSAL_RUNTIME_PATH;

let tmpDirPath: string | null = null;

async function importLearnerModule() {
  return import(new URL(`./causal-edge-learner.ts?test=${Date.now()}`, import.meta.url).href);
}

function createMemoryDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.run(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      normalized_content TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      emotion TEXT NOT NULL DEFAULT 'neutral',
      importance INTEGER NOT NULL DEFAULT 3,
      category TEXT NOT NULL DEFAULT 'daily',
      access_count INTEGER NOT NULL DEFAULT 0,
      last_accessed TEXT NOT NULL DEFAULT '',
      linked_ids TEXT NOT NULL DEFAULT '',
      episode_id TEXT,
      sensory_data TEXT NOT NULL DEFAULT '',
      camera_position TEXT,
      tags TEXT NOT NULL DEFAULT '',
      links TEXT NOT NULL DEFAULT '',
      novelty_score REAL NOT NULL DEFAULT 0.0,
      prediction_error REAL NOT NULL DEFAULT 0.0,
      activation_count INTEGER NOT NULL DEFAULT 0,
      last_activated TEXT NOT NULL DEFAULT '',
      reading TEXT,
      freshness REAL NOT NULL DEFAULT 1.0
    )
  `);
  db.run(`
    CREATE TABLE episodes (
      id TEXT PRIMARY KEY,
      title TEXT,
      start_time TEXT,
      end_time TEXT,
      memory_ids TEXT,
      participants TEXT,
      location_context TEXT,
      summary TEXT,
      emotion TEXT,
      importance INTEGER
    )
  `);
  return db;
}

afterEach(async () => {
  if (ORIGINAL_MEMORY_DB_PATH == null) {
    delete process.env.MEMORY_DB_PATH;
  } else {
    process.env.MEMORY_DB_PATH = ORIGINAL_MEMORY_DB_PATH;
  }

  if (ORIGINAL_PENDING_LEARNED_EDGES_PATH == null) {
    delete process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH;
  } else {
    process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH = ORIGINAL_PENDING_LEARNED_EDGES_PATH;
  }

  if (ORIGINAL_CAUSAL_RUNTIME_PATH == null) {
    delete process.env.WARDROBE_CAUSAL_RUNTIME_PATH;
  } else {
    process.env.WARDROBE_CAUSAL_RUNTIME_PATH = ORIGINAL_CAUSAL_RUNTIME_PATH;
  }

  if (tmpDirPath) {
    await rm(tmpDirPath, { recursive: true, force: true });
    tmpDirPath = null;
  }
});

describe("causal-edge-learner", () => {
  test("keeps ambiguous direction candidates and writes evidence summaries without touching runtime", async () => {
    tmpDirPath = await mkdtemp(join(tmpdir(), "persona-causal-edge-learner-test-"));
    process.env.MEMORY_DB_PATH = join(tmpDirPath, "memory.db");
    process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH = join(tmpDirPath, "pending-learned-edges.json");
    process.env.WARDROBE_CAUSAL_RUNTIME_PATH = join(tmpDirPath, "causal-runtime.json");

    const db = createMemoryDb(process.env.MEMORY_DB_PATH);
    for (let index = 0; index < 5; index += 1) {
      db.run(
        `INSERT INTO memories (
          id, content, normalized_content, timestamp, emotion, importance, category,
          access_count, linked_ids, tags, links, activation_count, freshness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `memory-ambiguous-${index}`,
          `動きやすさが戻って気分も少し軽い。第${index}観測。`,
          `動きやすさが戻って気分も少し軽い。第${index}観測。`,
          `2026-04-2${index}T09:00:00.000Z`,
          "happy",
          4 + (index % 2),
          "daily",
          0,
          "",
          "",
          "",
          0,
          0.9,
        ],
      );
    }
    db.close();

    const module = await importLearnerModule();
    const snapshot = await module.buildAndSavePendingLearnedEdgesSnapshot({
      now: new Date("2026-04-25T11:00:00.000Z"),
    });

    expect(snapshot.candidateCount).toBe(1);
    expect(snapshot.candidates[0]?.pair).toEqual(["mood", "energy"]);
    expect(snapshot.candidates[0]?.direction).toBe("ambiguous");
    expect(snapshot.candidates[0]?.source).toBeNull();
    expect(snapshot.candidates[0]?.target).toBeNull();
    expect(snapshot.candidates[0]?.evidenceCount).toBe(5);
    expect(snapshot.candidates[0]?.evidenceSummary).toHaveLength(3);
    expect(snapshot.candidates[0]?.evidenceSummary[0]?.contentSnippet.length).toBeLessThanOrEqual(51);
    expect(existsSync(process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH)).toBe(true);
    expect(existsSync(process.env.WARDROBE_CAUSAL_RUNTIME_PATH)).toBe(false);
  });

  test("adds satiation to the Phase5 node filter and preserves it in pending candidates", async () => {
    const module = await importLearnerModule();

    expect(module.inferPhase5AffectedNodes({
      id: "memory-satiation",
      content: "満たされていて、気分もやわらかい。消化したい感じがある。",
      timestamp: "2026-04-25T00:00:00.000Z",
      emotion: "happy",
      importance: 4,
      category: "daily",
      access_count: 0,
      activation_count: 0,
      freshness: 1,
      tags: "",
      episode_participants: "",
      episode_summary: "",
    })).toEqual(expect.arrayContaining(["mood", "satiation"]));

    tmpDirPath = await mkdtemp(join(tmpdir(), "persona-causal-edge-learner-satiation-test-"));
    process.env.MEMORY_DB_PATH = join(tmpDirPath, "memory.db");
    process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH = join(tmpDirPath, "pending-learned-edges.json");

    const db = createMemoryDb(process.env.MEMORY_DB_PATH);
    for (let index = 0; index < 5; index += 1) {
      db.run(
        `INSERT INTO memories (
          id, content, normalized_content, timestamp, emotion, importance, category,
          access_count, linked_ids, tags, links, activation_count, freshness
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `memory-satiation-${index}`,
          `満たされていて安心し、気分もやわらかい。消化を優先したい。第${index}観測。`,
          `満たされていて安心し、気分もやわらかい。消化を優先したい。第${index}観測。`,
          `2026-04-1${index}T08:00:00.000Z`,
          "happy",
          5,
          "daily",
          0,
          "",
          "",
          "",
          0,
          0.95,
        ],
      );
    }
    db.close();

    const snapshot = await module.buildAndSavePendingLearnedEdgesSnapshot({
      now: new Date("2026-04-25T12:00:00.000Z"),
    });

    const candidate = snapshot.candidates.find((entry: { pair: [string, string] }) => (
      entry.pair[0] === "mood" && entry.pair[1] === "satiation"
    ));
    expect(candidate).toBeTruthy();
    expect(candidate?.evidenceCount).toBe(5);
  });
});
