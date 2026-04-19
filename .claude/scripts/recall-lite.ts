#!/usr/bin/env bun

/**
 * recall-lite — 軽量自動想起フック
 *
 * causal bridge と交差する記憶を最大 1 件だけ出す。
 * それに加えて、legacy recall-lite の「未完了の可能性」だけは常に併記する。
 */

import { Database } from "bun:sqlite";

import {
  buildAndSaveCausalMemoryRuntimeSnapshot,
  renderCausalMemoryHint,
} from "./causal-memory-bridge";
import { resolveMemoryDbPath } from "./memory-db-path";

const DB_PATH = resolveMemoryDbPath({ scriptDir: import.meta.dir });

interface MemoryRow {
  id: string;
  content: string;
  importance: number;
  category: string;
  emotion: string;
  timestamp: string;
  access_count: number;
}

function formatHint(label: string, memories: MemoryRow[]): string {
  if (memories.length === 0) return "";
  const items = memories
    .map((memory) => {
      const short =
        memory.content.length > 80 ? `${memory.content.slice(0, 80)}…` : memory.content;
      return `  - ${short}`;
    })
    .join("\n");
  return `[${label}]\n${items}`;
}

export function buildLegacyUnfinishedHintText(dbPath = DB_PATH): string {
  const db = new Database(dbPath, { readonly: true });

  try {
    const unfinished = db
      .query<MemoryRow, []>(
        `SELECT id, content, importance, category, emotion, timestamp, access_count
         FROM memories
         WHERE content LIKE '%未完了%'
            OR content LIKE '%進行中%'
            OR content LIKE '%未着手%'
            OR content LIKE '%残り%'
         ORDER BY timestamp DESC
         LIMIT 3`,
      )
      .all();

    return formatHint("未完了の可能性", unfinished);
  } finally {
    db.close();
  }
}

export function buildRecallLiteText(options: {
  bridgeText?: string;
  unfinishedText?: string;
}): string {
  const sections = [options.bridgeText?.trim(), options.unfinishedText?.trim()]
    .filter((section): section is string => Boolean(section));
  return sections.join("\n");
}

async function main() {
  let bridgeText = "";
  let unfinishedText = "";

  try {
    const bridgeSnapshot = await buildAndSaveCausalMemoryRuntimeSnapshot();
    bridgeText = renderCausalMemoryHint(bridgeSnapshot);
  } catch {
    // causal bridge が失敗しても unfinished は別途試す
  }

  try {
    unfinishedText = buildLegacyUnfinishedHintText();
  } catch {
    // memory DB が読めない場合は静かに終了
  }

  const text = buildRecallLiteText({ bridgeText, unfinishedText });
  if (text) {
    process.stdout.write(text);
  }
}

if (import.meta.main) {
  await main();
}
