#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { parseArgs } from "util";

import { resolveMemoryDbPath } from "./memory-db-path";

interface MemoryRow {
  id: string;
  content: string;
  timestamp: string;
  emotion: string;
  importance: number;
  category: string;
}

interface DiscussionMemoState {
  days: Record<string, {
    summarizedIds: string[];
    updatedAt: string;
  }>;
}

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const DISCUSSION_MEMO_DIR = resolve(PROJECT_ROOT, "memo/discussionMemo");
const STATE_PATH = resolve(
  PROJECT_ROOT,
  ".claude/workingDirs/discussion-memo-state.json"
);
const DEFAULT_DB_PATH = resolveMemoryDbPath({ scriptDir: import.meta.dir });
const MAX_RECENT_MEMORIES = 200;
const MAX_DETAIL_LINES = 8;

const CATEGORY_LABELS: Record<string, string> = {
  conversation: "会話",
  technical: "技術",
  observation: "観測",
  daily: "日常",
  feeling: "感情",
  memory: "記憶",
  philosophical: "思索",
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatFileDate(date: Date): string {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function formatTimeLabel(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseTargetDate(raw?: string): Date {
  if (!raw) return new Date();

  const yyyymmdd = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd) {
    return new Date(
      Number(yyyymmdd[1]),
      Number(yyyymmdd[2]) - 1,
      Number(yyyymmdd[3]),
      0,
      0,
      0,
      0
    );
  }

  const yyyyMmDd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (yyyyMmDd) {
    return new Date(
      Number(yyyyMmDd[1]),
      Number(yyyyMmDd[2]) - 1,
      Number(yyyyMmDd[3]),
      0,
      0,
      0,
      0
    );
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid --date value: ${raw}`);
  }
  return parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

async function loadState(): Promise<DiscussionMemoState> {
  if (!existsSync(STATE_PATH)) {
    return { days: {} };
  }

  try {
    return JSON.parse(await Bun.file(STATE_PATH).text()) as DiscussionMemoState;
  } catch {
    return { days: {} };
  }
}

async function saveState(state: DiscussionMemoState): Promise<void> {
  mkdirSync(dirname(STATE_PATH), { recursive: true });

  const entries = Object.entries(state.days)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 31);

  const trimmed: DiscussionMemoState = {
    days: Object.fromEntries(entries),
  };

  await Bun.write(STATE_PATH, JSON.stringify(trimmed, null, 2) + "\n");
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ensureSentence(text: string): string {
  if (!text) return text;
  if (/[。！？!?]$/.test(text)) return text;
  return `${text}。`;
}

function shortenContent(text: string, maxLength = 110): string {
  const cleaned = normalizeWhitespace(text);
  if (!cleaned) return "";

  const sentences = cleaned
    .split(/(?<=[。！？!?])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  let summary = sentences[0] || cleaned;
  if (summary.length < 45 && sentences.length > 1) {
    summary = `${summary} ${sentences[1]}`.trim();
  }
  if (summary.length > maxLength) {
    summary = `${summary.slice(0, maxLength - 1).trimEnd()}…`;
  }
  return ensureSentence(summary);
}

function normalizedSummaryKey(memory: MemoryRow): string {
  return shortenContent(memory.content, 120)
    .replace(/[。！？!?]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function dedupeMemories(memories: MemoryRow[]): MemoryRow[] {
  const bestByKey = new Map<string, MemoryRow>();

  for (const memory of memories) {
    const key = normalizedSummaryKey(memory);
    const current = bestByKey.get(key);
    if (
      !current ||
      memory.importance > current.importance ||
      (memory.importance === current.importance &&
        memory.timestamp > current.timestamp)
    ) {
      bestByKey.set(key, memory);
    }
  }

  return Array.from(bestByKey.values());
}

function pickHighlights(memories: MemoryRow[], limit: number): MemoryRow[] {
  return [...memories]
    .sort((a, b) => {
      if (b.importance !== a.importance) {
        return b.importance - a.importance;
      }
      return b.timestamp.localeCompare(a.timestamp);
    })
    .slice(0, limit)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function buildOverviewLine(memories: MemoryRow[]): string {
  const categoryCounts = new Map<string, number>();
  for (const memory of memories) {
    categoryCounts.set(
      memory.category,
      (categoryCounts.get(memory.category) || 0) + 1
    );
  }

  const orderedCategories = Array.from(categoryCounts.entries()).sort((a, b) => {
    if (a[0] === "conversation") return -1;
    if (b[0] === "conversation") return 1;
    if (a[0] === "technical") return -1;
    if (b[0] === "technical") return 1;
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const categorySummary = orderedCategories
    .slice(0, 4)
    .map(([category, count]) => `${CATEGORY_LABELS[category] || category} ${count}件`)
    .join("、");

  return ensureSentence(
    `当日の記憶を ${memories.length} 件反映。${categorySummary || "カテゴリ情報なし"}`
  );
}

function buildDetailLines(memories: MemoryRow[]): string[] {
  const deduped = dedupeMemories(memories);
  const conversation = deduped.filter((memory) => memory.category === "conversation");
  const technical = deduped.filter((memory) => memory.category === "technical");
  const others = deduped.filter(
    (memory) => memory.category !== "conversation" && memory.category !== "technical"
  );

  const conversationHighlights = pickHighlights(conversation, Math.min(5, conversation.length));
  const remainingSlots = Math.max(
    0,
    MAX_DETAIL_LINES - conversationHighlights.length
  );
  const technicalLimit =
    conversationHighlights.length > 0
      ? Math.min(2, remainingSlots)
      : Math.min(5, remainingSlots || 5);
  const technicalHighlights = pickHighlights(technical, technicalLimit);
  const slotsAfterTechnical = Math.max(
    0,
    remainingSlots - technicalHighlights.length
  );
  const otherLimit =
    conversationHighlights.length > 0
      ? Math.min(3, slotsAfterTechnical)
      : Math.min(5, slotsAfterTechnical);
  const otherHighlights = pickHighlights(others, otherLimit);

  const selected = [
    ...conversationHighlights,
    ...technicalHighlights,
    ...otherHighlights,
  ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const lines = selected.map((memory) => {
    const summary = shortenContent(memory.content);
    if (memory.category === "conversation") {
      return summary;
    }
    const label = CATEGORY_LABELS[memory.category] || memory.category;
    return `${label}: ${summary}`;
  });

  const omitted = Math.max(0, deduped.length - selected.length);
  if (omitted > 0) {
    lines.push(`ほか ${omitted} 件の記憶もあり、詳細は memory 側に残っている。`);
  }

  return lines.map((line) => ensureSentence(line));
}

function renderEntry(memories: MemoryRow[], renderedAt: Date): string {
  const heading = `## 自動追記 ${formatTimeLabel(renderedAt)}`;
  const prompt = "❯ 当日の記憶を自動要約";
  const lines = [
    buildOverviewLine(memories),
    ...buildDetailLines(memories),
  ].map((line) => `● ${line}`);

  return `${heading}\n\n${prompt}\n\n${lines.join("\n")}\n`;
}

async function ensureDailyFile(filePath: string, isoDate: string): Promise<string> {
  mkdirSync(dirname(filePath), { recursive: true });

  if (!existsSync(filePath)) {
    return `# ${isoDate}\n\n`;
  }

  return await Bun.file(filePath).text();
}

function buildDayRange(targetDate: Date): { start: string; end: string } {
  const dayStart = startOfDay(targetDate);
  const nextDayStart = addDays(dayStart, 1);
  return {
    start: `${formatIsoDate(dayStart)}T00:00:00`,
    end: `${formatIsoDate(nextDayStart)}T00:00:00`,
  };
}

function fetchRecentMemoriesForDay(
  dbPath: string,
  targetDate: Date
): MemoryRow[] {
  if (!existsSync(dbPath)) {
    return [];
  }

  const { start, end } = buildDayRange(targetDate);
  const db = new Database(dbPath, { readonly: true });

  try {
    return db
      .query<MemoryRow, [string, string, number]>(
        `SELECT id, content, timestamp, emotion, importance, category
         FROM memories
         WHERE timestamp >= ? AND timestamp < ?
         ORDER BY timestamp ASC
         LIMIT ?`
      )
      .all(start, end, MAX_RECENT_MEMORIES);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      date: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      force: { type: "boolean", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const targetDate = parseTargetDate(values.date as string | undefined);
  const isoDate = formatIsoDate(targetDate);
  const fileDate = formatFileDate(targetDate);
  const discussionMemoPath = resolve(DISCUSSION_MEMO_DIR, `${fileDate}.md`);
  const state = await loadState();
  const summarizedIds = new Set(
    values.force
      ? []
      : state.days[fileDate]?.summarizedIds || []
  );

  const todaysMemories = fetchRecentMemoriesForDay(DEFAULT_DB_PATH, targetDate);
  const newMemories = todaysMemories.filter((memory) => !summarizedIds.has(memory.id));

  if (newMemories.length === 0) {
    console.log(`[discussion-memo] no new memories for ${isoDate}`);
    return;
  }

  const renderedAt = new Date();
  const entry = renderEntry(newMemories, renderedAt);

  if (values["dry-run"]) {
    console.log(`[discussion-memo] dry-run for ${discussionMemoPath}`);
    console.log(entry.trimEnd());
    return;
  }

  const currentText = await ensureDailyFile(discussionMemoPath, isoDate);
  const separator = currentText.trimEnd().length > 0 ? "\n\n" : "";
  const nextText = `${currentText.trimEnd()}${separator}${entry}`;
  await Bun.write(discussionMemoPath, nextText);

  state.days[fileDate] = {
    summarizedIds: [
      ...new Set([
        ...(state.days[fileDate]?.summarizedIds || []),
        ...newMemories.map((memory) => memory.id),
      ]),
    ],
    updatedAt: renderedAt.toISOString(),
  };
  await saveState(state);

  console.log(
    `[discussion-memo] appended ${newMemories.length} memories to ${discussionMemoPath}`
  );
}

await main();
