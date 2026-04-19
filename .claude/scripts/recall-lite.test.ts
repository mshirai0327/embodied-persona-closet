import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";

const ORIGINAL_MEMORY_DB_PATH = process.env.MEMORY_DB_PATH;

let tmpDirPath: string | null = null;

async function importRecallLiteModule() {
  return import(new URL(`./recall-lite.ts?test=${Date.now()}`, import.meta.url).href);
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
  return db;
}

afterEach(async () => {
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

describe("recall-lite", () => {
  test("builds only the unfinished hint from legacy recall", async () => {
    tmpDirPath = await mkdtemp(join(tmpdir(), "persona-recall-lite-test-"));
    process.env.MEMORY_DB_PATH = join(tmpDirPath, "memory.db");

    const db = createMemoryDb(process.env.MEMORY_DB_PATH);
    db.run(
      `INSERT INTO memories (
        id, content, normalized_content, timestamp, emotion, importance, category, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "unfinished-1",
        "Phase4の未完了タスク。残りは recall-lite の整理。",
        "Phase4の未完了タスク。残りは recall-lite の整理。",
        "2026-04-19T10:00:00.000Z",
        "neutral",
        4,
        "daily",
        0,
      ],
    );
    db.run(
      `INSERT INTO memories (
        id, content, normalized_content, timestamp, emotion, importance, category, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "finished-1",
        "今日は実装の手応えがあった。",
        "今日は実装の手応えがあった。",
        "2026-04-19T09:00:00.000Z",
        "happy",
        4,
        "daily",
        0,
      ],
    );
    db.close();

    const module = await importRecallLiteModule();
    const text = module.buildLegacyUnfinishedHintText(process.env.MEMORY_DB_PATH);

    expect(text).toContain("[未完了の可能性]");
    expect(text).toContain("recall-lite の整理");
    expect(text).not.toContain("実装の手応え");
  });

  test("joins bridge text and unfinished text without adding extra sections", async () => {
    const module = await importRecallLiteModule();

    expect(module.buildRecallLiteText({
      bridgeText: "[memory-hint]\n  - 最近の安心できる対話が、対人姿勢を少し開きやすくしている。",
      unfinishedText: "[未完了の可能性]\n  - SOUL.md更新は確認待ち",
    })).toBe(
      "[memory-hint]\n  - 最近の安心できる対話が、対人姿勢を少し開きやすくしている。\n[未完了の可能性]\n  - SOUL.md更新は確認待ち",
    );

    expect(module.buildRecallLiteText({
      bridgeText: "",
      unfinishedText: "[未完了の可能性]\n  - SOUL.md更新は確認待ち",
    })).toBe("[未完了の可能性]\n  - SOUL.md更新は確認待ち");
  });
});
