import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";

const ORIGINAL_MEMORY_DB_PATH = process.env.MEMORY_DB_PATH;
const ORIGINAL_PENDING_LEARNED_EDGES_PATH = process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH;
const ORIGINAL_LEARNED_SEEDS_PATH = process.env.WARDROBE_LEARNED_SEEDS_PATH;
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

  if (ORIGINAL_LEARNED_SEEDS_PATH == null) {
    delete process.env.WARDROBE_LEARNED_SEEDS_PATH;
  } else {
    process.env.WARDROBE_LEARNED_SEEDS_PATH = ORIGINAL_LEARNED_SEEDS_PATH;
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

  test("promotes pending candidates into learned seeds with stable IDs and idempotency", async () => {
    tmpDirPath = await mkdtemp(join(tmpdir(), "persona-causal-edge-learner-promote-test-"));
    process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH = join(tmpDirPath, "pending-learned-edges.json");
    process.env.WARDROBE_LEARNED_SEEDS_PATH = join(tmpDirPath, "learned-seeds.json");

    const module = await importLearnerModule();
    const pending = {
      updatedAt: "2026-04-25T13:00:00.000Z",
      memoryDbPath: join(tmpDirPath, "memory.db"),
      scanLimit: 200,
      scannedMemoryCount: 12,
      candidateCount: 2,
      candidates: [
        {
          id: "pending_mood_trust_mizuho",
          pair: ["mood", "trust_mizuho"],
          source: "trust_mizuho",
          target: "mood",
          direction: "trust_mizuho->mood",
          evidenceCount: 6,
          evidenceMemoryIds: ["m1", "m2", "m3", "m4", "m5", "m6"],
          evidenceSummary: [
            {
              id: "m1",
              timestamp: "2026-04-25T12:00:00.000Z",
              valence: "positive",
              contentSnippet: "mizuhoと話したあと、気分が軽くなった。",
            },
          ],
          positiveEvidenceCount: 6,
          negativeEvidenceCount: 0,
          neutralEvidenceCount: 0,
          timeSignal: {
            leadNode: "trust_mizuho",
            lagNode: "mood",
            deltaHours: 8,
            averageTimestamps: {
              mood: "2026-04-25T12:00:00.000Z",
              trust_mizuho: "2026-04-25T04:00:00.000Z",
            },
          },
        },
        {
          id: "pending_mood_health",
          pair: ["mood", "health"],
          source: null,
          target: null,
          direction: "ambiguous",
          evidenceCount: 5,
          evidenceMemoryIds: ["a1", "a2", "a3", "a4", "a5"],
          evidenceSummary: [
            {
              id: "a1",
              timestamp: "2026-04-25T10:00:00.000Z",
              valence: "negative",
              contentSnippet: "気分と健康感の両方が少し下がった。",
            },
          ],
          positiveEvidenceCount: 2,
          negativeEvidenceCount: 2,
          neutralEvidenceCount: 1,
          timeSignal: {
            leadNode: null,
            lagNode: null,
            deltaHours: 2.25,
            averageTimestamps: {
              mood: "2026-04-25T10:00:00.000Z",
              health: "2026-04-25T12:15:00.000Z",
            },
          },
        },
      ],
    } satisfies Awaited<ReturnType<typeof module.readPendingLearnedEdgesSnapshot>> extends infer T
      ? T extends object
        ? NonNullable<T>
        : never
      : never;

    await module.savePendingLearnedEdgesSnapshot(pending);
    const first = await module.promotePendingLearnedEdgesSnapshot({
      now: new Date("2026-04-25T13:30:00.000Z"),
    });

    expect(first.promotedCount).toBe(2);
    expect(first.skippedCount).toBe(0);

    const learned = await module.readLearnedSeedsSnapshot();
    expect(learned.learnedEdges).toHaveLength(2);

    const trustMood = learned.learnedEdges.find((edge: { id: string }) => edge.id === "learned_trust_mizuho_mood_001");
    expect(trustMood).toBeTruthy();
    expect(trustMood?.status).toBe("observing");
    expect(trustMood?.weight).toBe(0.3);
    expect(trustMood?.relation).toBe("lifts");
    expect(trustMood?.direction).toBe("trust_mizuho->mood");

    const ambiguous = learned.learnedEdges.find((edge: { id: string }) => edge.id === "learned_mood_health_001");
    expect(ambiguous).toBeTruthy();
    expect(ambiguous?.direction).toBe("ambiguous");
    expect(ambiguous?.source).toBeNull();
    expect(ambiguous?.target).toBeNull();
    expect(ambiguous?.relation).toBe("modulates");

    const second = await module.promotePendingLearnedEdgesSnapshot({
      now: new Date("2026-04-25T14:00:00.000Z"),
    });
    expect(second.promotedCount).toBe(0);
    expect(second.skippedCount).toBe(2);

    const learnedAgain = await module.readLearnedSeedsSnapshot();
    expect(learnedAgain.learnedEdges).toHaveLength(2);
  });
});
