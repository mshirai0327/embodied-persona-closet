import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";

import type { CausalStatusProposal } from "./causal-runtime";
import { readCausalRuntimeSnapshot, saveCausalRuntimeSnapshot } from "./causal-hint-store";

const ORIGINAL_CAUSAL_RUNTIME_PATH = process.env.WARDROBE_CAUSAL_RUNTIME_PATH;
const ORIGINAL_CAUSAL_MEMORY_RUNTIME_PATH = process.env.WARDROBE_CAUSAL_MEMORY_RUNTIME_PATH;
const ORIGINAL_MEMORY_DB_PATH = process.env.MEMORY_DB_PATH;

let tmpDirPath: string | null = null;

async function importBridgeModule() {
  return import(new URL(`./causal-memory-bridge.ts?test=${Date.now()}`, import.meta.url).href);
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
  if (ORIGINAL_CAUSAL_RUNTIME_PATH == null) {
    delete process.env.WARDROBE_CAUSAL_RUNTIME_PATH;
  } else {
    process.env.WARDROBE_CAUSAL_RUNTIME_PATH = ORIGINAL_CAUSAL_RUNTIME_PATH;
  }

  if (ORIGINAL_CAUSAL_MEMORY_RUNTIME_PATH == null) {
    delete process.env.WARDROBE_CAUSAL_MEMORY_RUNTIME_PATH;
  } else {
    process.env.WARDROBE_CAUSAL_MEMORY_RUNTIME_PATH = ORIGINAL_CAUSAL_MEMORY_RUNTIME_PATH;
  }

  if (ORIGINAL_MEMORY_DB_PATH == null) {
    delete process.env.MEMORY_DB_PATH;
  } else {
    process.env.MEMORY_DB_PATH = ORIGINAL_MEMORY_DB_PATH;
  }

  if (tmpDirPath) {
    await rm(tmpDirPath, { recursive: true, force: true });
    tmpDirPath = null;
  }
});

describe("causal-memory-bridge", () => {
  test("selects one recent memory that overlaps active causal nodes", async () => {
    tmpDirPath = await mkdtemp(join(tmpdir(), "persona-causal-memory-bridge-test-"));
    process.env.WARDROBE_CAUSAL_RUNTIME_PATH = join(tmpDirPath, "causal-runtime.json");
    process.env.WARDROBE_CAUSAL_MEMORY_RUNTIME_PATH = join(tmpDirPath, "causal-memory-runtime.json");
    process.env.MEMORY_DB_PATH = join(tmpDirPath, "memory.db");

    const proposals: CausalStatusProposal[] = [
      {
        field: "energy",
        score: 0.42,
        delta: 4,
        reason: "環境熱負荷 proxy 28/100",
        topPathDescription: "環境熱負荷 proxy → energy",
        contributingSources: ["environment_thermal_load"],
      },
      {
        field: "health",
        score: 0.31,
        delta: 2,
        reason: "気温 20/100",
        topPathDescription: "気温 → health",
        contributingSources: ["ambient_temperature"],
      },
    ];
    await saveCausalRuntimeSnapshot(proposals, {
      now: new Date("2026-04-19T09:00:00.000Z"),
    });
    expect(await readCausalRuntimeSnapshot()).not.toBeNull();

    const db = createMemoryDb(process.env.MEMORY_DB_PATH);
    db.run(
      `INSERT INTO memories (
        id, content, normalized_content, timestamp, emotion, importance, category,
        access_count, linked_ids, tags, links, activation_count, freshness
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "memory-energy-positive",
        "熱負荷が落ち着いて energy が戻り、動きやすさと無理しすぎない感じがあった。",
        "熱負荷が落ち着いて energy が戻り、動きやすさと無理しすぎない感じがあった。",
        "2026-04-19T08:30:00.000Z",
        "happy",
        5,
        "daily",
        2,
        "",
        "",
        "",
        3,
        0.95,
      ],
    );
    db.run(
      `INSERT INTO memories (
        id, content, normalized_content, timestamp, emotion, importance, category,
        access_count, linked_ids, tags, links, activation_count, freshness
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "memory-unrelated",
        "mizuhoが私の絵を描いてくれて嬉しかった。",
        "mizuhoが私の絵を描いてくれて嬉しかった。",
        "2026-04-19T08:45:00.000Z",
        "moved",
        4,
        "conversation",
        1,
        "",
        "",
        "",
        1,
        0.95,
      ],
    );
    db.close();

    const module = await importBridgeModule();
    const snapshot = await module.buildAndSaveCausalMemoryRuntimeSnapshot({
      now: new Date("2026-04-19T09:30:00.000Z"),
    });

    expect(snapshot.mode).toBe("causal");
    expect(snapshot.selectedMemoryCount).toBe(1);
    expect(snapshot.selectedMemoryId).toBe("memory-energy-positive");
    expect(snapshot.selectedMemory?.matchedNodes).toEqual(expect.arrayContaining(["energy", "health"]));
    expect(snapshot.selectedMemoryScore).toBeGreaterThan(2);
    expect(snapshot.promptText).toContain("動きやすさ");
    expect(module.renderCausalMemoryHint(snapshot)).toContain("[memory-hint");
    expect(module.renderCausalMemoryHint(snapshot)).not.toContain("energy");

    const reloaded = await module.readCausalMemoryRuntimeSnapshot();
    expect(reloaded?.selectedMemoryId).toBe("memory-energy-positive");
  });

  test("stays silent when no memory intersects the active causal nodes", async () => {
    tmpDirPath = await mkdtemp(join(tmpdir(), "persona-causal-memory-bridge-empty-test-"));
    process.env.WARDROBE_CAUSAL_RUNTIME_PATH = join(tmpDirPath, "causal-runtime.json");
    process.env.WARDROBE_CAUSAL_MEMORY_RUNTIME_PATH = join(tmpDirPath, "causal-memory-runtime.json");
    process.env.MEMORY_DB_PATH = join(tmpDirPath, "memory.db");

    await saveCausalRuntimeSnapshot([
      {
        field: "mood",
        score: -0.36,
        delta: -2,
        reason: "環境光 22/100",
        topPathDescription: "環境光 → mood",
        contributingSources: ["ambient_brightness"],
      },
    ], {
      now: new Date("2026-04-19T10:00:00.000Z"),
    });

    const db = createMemoryDb(process.env.MEMORY_DB_PATH);
    db.run(
      `INSERT INTO memories (
        id, content, normalized_content, timestamp, emotion, importance, category,
        access_count, linked_ids, tags, links, activation_count, freshness
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "memory-unrelated-technical",
        "Kuzu の seed を整理して latent ノードを削除した。",
        "Kuzu の seed を整理して latent ノードを削除した。",
        "2026-04-19T09:45:00.000Z",
        "neutral",
        4,
        "technical",
        0,
        "",
        "",
        "",
        0,
        0.9,
      ],
    );
    db.close();

    const module = await importBridgeModule();
    const snapshot = await module.buildAndSaveCausalMemoryRuntimeSnapshot({
      now: new Date("2026-04-19T10:30:00.000Z"),
    });

    expect(snapshot.mode).toBe("none");
    expect(snapshot.selectedMemoryCount).toBe(0);
    expect(snapshot.promptText).toBe("");
    expect(snapshot.reason).toContain("intersect");
    expect(module.renderCausalMemoryHint(snapshot)).toBe("");
  });
});
