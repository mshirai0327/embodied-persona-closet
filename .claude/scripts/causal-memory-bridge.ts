#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  readCausalRuntimeSnapshot,
  type CausalRuntimeSnapshot,
} from "./causal-hint-store";
import { resolveMemoryDbPath } from "./memory-db-path";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_CAUSAL_MEMORY_RUNTIME_PATH = resolve(
  PROJECT_ROOT,
  ".claude/workingDirs/causal-memory-runtime.json",
);
const MEMORY_SCAN_LIMIT = 160;
const ACTIVE_SCORE_THRESHOLD = 0.14;
const MAX_TOP_CANDIDATES = 5;
const MIN_SELECTION_SCORE = 2.05;

const POSITIVE_EMOTIONS = new Set(["happy", "moved", "excited"]);
const NEGATIVE_EMOTIONS = new Set(["sad", "angry", "afraid", "anxious", "upset"]);

const POSITIVE_VALENCE_HINTS = [
  "安心",
  "嬉",
  "楽しい",
  "落ち着",
  "やわらか",
  "手応え",
  "完了",
  "完成",
  "成功",
  "確定",
  "接続済み",
  "動作確認",
  "通った",
  "回復",
  "戻り",
  "動きやす",
  "持ち直",
  "軽い",
  "支える",
  "引き上げ",
  "満た",
] as const;

const NEGATIVE_VALENCE_HINTS = [
  "不安",
  "重い",
  "しんど",
  "消耗",
  "消耗気味",
  "疲れ",
  "沈む",
  "沈み",
  "陰り",
  "控えめ",
  "圧迫",
  "削ら",
  "下がっ",
  "下げ",
  "落ち込",
  "慎重",
  "守りたい",
  "守る動き",
  "負荷",
  "暗い",
  "反応は控えめ",
] as const;

const CATEGORY_WEIGHTS: Record<string, number> = {
  conversation: 0.35,
  daily: 0.28,
  observation: 0.18,
  memory: 0.16,
  philosophical: 0.12,
  technical: 0.02,
};

const NODE_HINTS = {
  mood: {
    explicit: ["mood", "気分", "感情", "気持ち"],
    implicit: ["明る", "暗い", "笑顔", "嬉", "楽しい", "沈", "陰り", "落ち着", "ほどけ"],
  },
  energy: {
    explicit: ["energy", "活力"],
    implicit: ["動きやす", "動き出", "疲れ", "消耗", "回復", "熱負荷", "熱がこも", "重い", "軽め"],
  },
  health: {
    explicit: ["health", "健康", "体調"],
    implicit: ["無理", "安定", "保て", "崩れ", "消耗", "回復", "しんど", "落ち着いていられる"],
  },
  trust_mizuho: {
    explicit: ["trust_mizuho", "信頼", "安心"],
    implicit: ["mizuho", "一緒", "教えてくれ", "描いてくれ", "見せてくれ", "配慮", "話しかけ"],
  },
  social_openness: {
    explicit: ["social_openness"],
    implicit: ["対話", "話しかけ", "返信", "投稿", "ai-lounge", "外へ", "会話", "開きやす"],
  },
  mental_margin: {
    explicit: ["mental_margin", "余白"],
    implicit: ["落ち着", "静か", "整える", "保て", "守る", "消化", "無理しない"],
  },
} as const;

export const BRIDGE_NODE_IDS = [
  "mood",
  "energy",
  "health",
  "trust_mizuho",
  "social_openness",
  "mental_margin",
] as const;

export type BridgeNodeId = typeof BRIDGE_NODE_IDS[number];
export type BridgeDirection = "positive" | "negative";
export type MemoryValence = "positive" | "negative" | "neutral";

interface MemoryBridgeRow {
  id: string;
  content: string;
  timestamp: string;
  emotion: string;
  importance: number;
  category: string;
  access_count: number;
  activation_count: number;
  freshness: number;
  tags: string;
  episode_participants: string;
  episode_summary: string;
}

export interface InferredMemoryMetadata {
  affectedNodes: BridgeNodeId[];
  entity: string | null;
  valence: MemoryValence;
  confidence: number;
  timeBias: number;
  narrativeRole: string;
}

interface ActiveNodeContext {
  node: BridgeNodeId;
  direction: BridgeDirection;
  score: number;
}

export interface ActiveCausalContext {
  updatedAt: string | null;
  activeNodes: ActiveNodeContext[];
  activeSources: string[];
}

interface ScoredCandidate {
  row: MemoryBridgeRow;
  metadata: InferredMemoryMetadata;
  matchedNodes: BridgeNodeId[];
  matchedNode: BridgeNodeId;
  matchedDirection: BridgeDirection;
  matchedScore: number;
  nodeOverlapCount: number;
  nodeOverlapScore: number;
  directionWeight: number;
  recencyWeight: number;
  importanceWeight: number;
  accessWeight: number;
  activationWeight: number;
  categoryWeight: number;
  score: number;
  promptText: string;
}

export interface CausalMemorySelection {
  id: string;
  timestamp: string;
  category: string;
  emotion: string;
  entity: string | null;
  valence: MemoryValence;
  affectedNodes: BridgeNodeId[];
  matchedNodes: BridgeNodeId[];
  matchedNode: BridgeNodeId;
  matchedDirection: BridgeDirection;
  score: number;
  nodeOverlapCount: number;
  nodeOverlapScore: number;
  recencyWeight: number;
  importanceWeight: number;
  accessWeight: number;
  activationWeight: number;
  categoryWeight: number;
  directionWeight: number;
  confidence: number;
  timeBias: number;
  narrativeRole: string;
  contentSnippet: string;
  promptText: string;
}

export interface TopCandidateSummary {
  id: string;
  score: number;
  matchedNodes: BridgeNodeId[];
  valence: MemoryValence;
  category: string;
  contentSnippet: string;
}

export interface CausalMemoryRuntimeSnapshot {
  updatedAt: string;
  mode: "causal" | "none";
  reason: string;
  activeNodes: ActiveNodeContext[];
  activeSources: string[];
  evaluatedCount: number;
  candidateCount: number;
  selectedMemoryCount: 0 | 1;
  selectedMemoryId: string | null;
  selectedMemoryScore: number | null;
  nodeOverlapCount: number;
  recencyWeight: number | null;
  confidence: number | null;
  promptText: string;
  selectedMemory: CausalMemorySelection | null;
  topCandidates: TopCandidateSummary[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clipText(value: string, limit = 92): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function countKeywordHits(text: string, keywords: readonly string[]): number {
  return keywords.reduce((count, keyword) => (
    text.includes(normalizeText(keyword)) ? count + 1 : count
  ), 0);
}

function inferEntity(row: MemoryBridgeRow): string | null {
  const text = normalizeText(`${row.content} ${row.episode_participants} ${row.episode_summary}`);
  if (text.includes("mizuho")) return "mizuho";
  return null;
}

export function inferMemoryValence(row: Pick<MemoryBridgeRow, "emotion" | "content" | "episode_summary">): MemoryValence {
  const text = normalizeText(`${row.content} ${row.episode_summary}`);

  let score = 0;
  if (POSITIVE_EMOTIONS.has(row.emotion)) score += 2;
  if (NEGATIVE_EMOTIONS.has(row.emotion)) score -= 2;

  score += countKeywordHits(text, POSITIVE_VALENCE_HINTS);
  score -= countKeywordHits(text, NEGATIVE_VALENCE_HINTS);

  if (/mood-\d|energy-\d|health-\d|score -\d/.test(text)) {
    score -= 1;
  }
  if (/mood\+\d|energy\+\d|health\+\d|score \+\d/.test(text)) {
    score += 1;
  }

  if (score >= 1) return "positive";
  if (score <= -1) return "negative";
  return "neutral";
}

function inferNarrativeRole(row: MemoryBridgeRow): string {
  switch (row.category) {
    case "conversation":
      return "dialogue";
    case "daily":
      return "daily";
    case "observation":
      return "observation";
    case "technical":
      return "implementation";
    case "philosophical":
      return "reflection";
    default:
      return "memory";
  }
}

export function inferAffectedNodes(row: MemoryBridgeRow): BridgeNodeId[] {
  const text = normalizeText(
    `${row.content}\n${row.episode_summary}\n${row.episode_participants}\n${row.tags}\n${row.category}\n${row.emotion}`,
  );
  const nodes = new Set<BridgeNodeId>();

  for (const nodeId of BRIDGE_NODE_IDS) {
    const hints = NODE_HINTS[nodeId];
    const explicitHits = countKeywordHits(text, hints.explicit);
    const implicitHits = countKeywordHits(text, hints.implicit);
    if (explicitHits > 0 || implicitHits >= 2) {
      nodes.add(nodeId);
    }
  }

  const entity = inferEntity(row);
  const valence = inferMemoryValence(row);

  if (entity === "mizuho") {
    nodes.add("trust_mizuho");
    if (row.category === "conversation" || row.category === "daily") {
      nodes.add("social_openness");
    }
  }

  if (["happy", "moved", "excited"].includes(row.emotion) && (row.category === "conversation" || row.category === "daily")) {
    nodes.add("mood");
  }

  if ((text.includes("回復") || text.includes("動きやす")) && valence !== "negative") {
    nodes.add("energy");
  }

  if ((text.includes("無理") || text.includes("安定") || text.includes("保て")) && row.category !== "technical") {
    nodes.add("health");
    nodes.add("mental_margin");
  }

  return Array.from(nodes);
}

export function computeTimeBias(timestamp: string, now = new Date()): number {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return 0;
  const ageHours = Math.max(0, (now.getTime() - parsed) / (1000 * 60 * 60));
  return Math.exp(-ageHours / 96);
}

export function inferMemoryMetadata(row: MemoryBridgeRow, now = new Date()): InferredMemoryMetadata {
  const affectedNodes = inferAffectedNodes(row);
  const entity = inferEntity(row);
  const valence = inferMemoryValence(row);
  const timeBias = computeTimeBias(row.timestamp, now);
  const narrativeRole = inferNarrativeRole(row);

  const text = normalizeText(`${row.content}\n${row.episode_summary}\n${row.episode_participants}`);
  const explicitHits = BRIDGE_NODE_IDS.reduce((count, nodeId) => (
    count + countKeywordHits(text, NODE_HINTS[nodeId].explicit)
  ), 0);
  const implicitHits = BRIDGE_NODE_IDS.reduce((count, nodeId) => (
    count + countKeywordHits(text, NODE_HINTS[nodeId].implicit)
  ), 0);

  const confidence = clamp(
    0.28
      + Math.min(affectedNodes.length, 3) * 0.14
      + explicitHits * 0.08
      + Math.min(implicitHits, 4) * 0.04
      + (entity ? 0.08 : 0)
      + (row.episode_participants ? 0.05 : 0),
    0,
    1,
  );

  return {
    affectedNodes,
    entity,
    valence,
    confidence,
    timeBias,
    narrativeRole,
  };
}

export function buildActiveCausalContext(snapshot: CausalRuntimeSnapshot | null): ActiveCausalContext {
  if (!snapshot) {
    return {
      updatedAt: null,
      activeNodes: [],
      activeSources: [],
    };
  }

  const sorted = [...snapshot.proposals]
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score));
  const activeNodes: ActiveNodeContext[] = [];

  for (const proposal of sorted) {
    const isActive = proposal.delta !== 0 || Math.abs(proposal.score) >= ACTIVE_SCORE_THRESHOLD;
    if (!isActive) continue;
    if (activeNodes.some((entry) => entry.node === proposal.field)) continue;

    activeNodes.push({
      node: proposal.field,
      direction: proposal.score >= 0 ? "positive" : "negative",
      score: proposal.score,
    });
  }

  if (activeNodes.length === 0 && sorted[0]) {
    activeNodes.push({
      node: sorted[0].field,
      direction: sorted[0].score >= 0 ? "positive" : "negative",
      score: sorted[0].score,
    });
  }

  return {
    updatedAt: snapshot.updatedAt,
    activeNodes,
    activeSources: snapshot.activeSources,
  };
}

function directionAlignmentWeight(memoryValence: MemoryValence, direction: BridgeDirection): number {
  if (memoryValence === "neutral") return 0.08;
  if (memoryValence === direction) return 0.42;
  return -0.18;
}

function buildLeadPhrase(candidate: Pick<ScoredCandidate, "metadata" | "row">): string {
  if (
    candidate.metadata.entity === "mizuho"
    && candidate.metadata.valence === "positive"
    && (candidate.row.category === "conversation" || candidate.row.category === "daily")
  ) {
    return "最近の安心できる対話";
  }

  if (candidate.row.category === "conversation" && candidate.metadata.valence === "positive") {
    return "最近のやわらかい対話";
  }

  if (candidate.row.category === "observation") {
    return "最近の観察で掴めた手応え";
  }

  if (candidate.row.category === "technical") {
    return "最近の実装の手応え";
  }

  if (candidate.row.category === "daily" && candidate.metadata.valence === "positive") {
    return "最近うまく流れた記憶";
  }

  if (candidate.metadata.valence === "negative") {
    return "最近の引っかかりのある記憶";
  }

  return "最近の記憶";
}

function buildEffectPhrase(node: BridgeNodeId, direction: BridgeDirection): string {
  if (node === "mood") {
    return direction === "positive"
      ? "気分を少し開きやすくしている。"
      : "気分の陰りに理由を与えている。";
  }
  if (node === "energy") {
    return direction === "positive"
      ? "今の動きやすさを少し支えている。"
      : "今は負荷を絞りたい感覚につながっている。";
  }
  if (node === "health") {
    return direction === "positive"
      ? "無理をしすぎない落ち着きを支えている。"
      : "守りを優先したい感覚につながっている。";
  }
  if (node === "trust_mizuho") {
    return direction === "positive"
      ? "対人姿勢を少し開きやすくしている。"
      : "人との距離を慎重にしたい感覚につながっている。";
  }
  if (node === "social_openness") {
    return direction === "positive"
      ? "外へ向く姿勢を少し開きやすくしている。"
      : "今は内側を守りたい感覚につながっている。";
  }
  return direction === "positive"
    ? "少し余白を保ちやすくしている。"
    : "余白を守りたい感覚につながっている。";
}

function buildPromptText(candidate: ScoredCandidate): string {
  return `${buildLeadPhrase(candidate)}が、${buildEffectPhrase(candidate.matchedNode, candidate.matchedDirection)}`;
}

function toSelection(candidate: ScoredCandidate): CausalMemorySelection {
  return {
    id: candidate.row.id,
    timestamp: candidate.row.timestamp,
    category: candidate.row.category,
    emotion: candidate.row.emotion,
    entity: candidate.metadata.entity,
    valence: candidate.metadata.valence,
    affectedNodes: candidate.metadata.affectedNodes,
    matchedNodes: candidate.matchedNodes,
    matchedNode: candidate.matchedNode,
    matchedDirection: candidate.matchedDirection,
    score: candidate.score,
    nodeOverlapCount: candidate.nodeOverlapCount,
    nodeOverlapScore: candidate.nodeOverlapScore,
    recencyWeight: candidate.recencyWeight,
    importanceWeight: candidate.importanceWeight,
    accessWeight: candidate.accessWeight,
    activationWeight: candidate.activationWeight,
    categoryWeight: candidate.categoryWeight,
    directionWeight: candidate.directionWeight,
    confidence: candidate.metadata.confidence,
    timeBias: candidate.metadata.timeBias,
    narrativeRole: candidate.metadata.narrativeRole,
    contentSnippet: clipText(candidate.row.content),
    promptText: candidate.promptText,
  };
}

function scoreCandidate(
  row: MemoryBridgeRow,
  context: ActiveCausalContext,
  now = new Date(),
): ScoredCandidate | null {
  const metadata = inferMemoryMetadata(row, now);
  const matchedContexts = context.activeNodes.filter((entry) => metadata.affectedNodes.includes(entry.node));
  if (matchedContexts.length === 0) {
    return null;
  }

  const matchedContextsByStrength = [...matchedContexts]
    .sort((left, right) => Math.abs(right.score) - Math.abs(left.score));
  const matchedNodes = matchedContextsByStrength.map((entry) => entry.node);
  const strongest = matchedContextsByStrength[0];
  const nodeOverlapCount = matchedContexts.length;
  const nodeOverlapScore = nodeOverlapCount * 1.25;
  const directionWeight = matchedContexts.reduce((sum, entry) => (
    sum + directionAlignmentWeight(metadata.valence, entry.direction)
  ), 0);
  const recencyWeight = metadata.timeBias * 0.95;
  const importanceWeight = Math.max(0, row.importance - 2) * 0.22;
  const accessWeight = Math.min(row.access_count, 8) * 0.03;
  const activationWeight = Math.min(row.activation_count, 8) * 0.04 + clamp(row.freshness, 0, 1) * 0.14;
  const categoryWeight = CATEGORY_WEIGHTS[row.category] ?? 0.1;
  const confidenceWeight = metadata.confidence * 0.25;

  const score = Number((
    nodeOverlapScore
    + directionWeight
    + recencyWeight
    + importanceWeight
    + accessWeight
    + activationWeight
    + categoryWeight
    + confidenceWeight
  ).toFixed(4));

  const candidate: ScoredCandidate = {
    row,
    metadata,
    matchedNodes,
    matchedNode: strongest.node,
    matchedDirection: strongest.direction,
    matchedScore: strongest.score,
    nodeOverlapCount,
    nodeOverlapScore,
    directionWeight,
    recencyWeight,
    importanceWeight,
    accessWeight,
    activationWeight,
    categoryWeight,
    score,
    promptText: "",
  };
  candidate.promptText = buildPromptText(candidate);
  return candidate;
}

function summarizeTopCandidates(candidates: ScoredCandidate[]): TopCandidateSummary[] {
  return candidates.slice(0, MAX_TOP_CANDIDATES).map((candidate) => ({
    id: candidate.row.id,
    score: candidate.score,
    matchedNodes: candidate.matchedNodes,
    valence: candidate.metadata.valence,
    category: candidate.row.category,
    contentSnippet: clipText(candidate.row.content),
  }));
}

function readMemoryRows(dbPath: string): MemoryBridgeRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query<MemoryBridgeRow, [number]>(
      `SELECT
         memories.id,
         memories.content,
         memories.timestamp,
         memories.emotion,
         memories.importance,
         memories.category,
         memories.access_count,
         memories.activation_count,
         memories.freshness,
         memories.tags,
         COALESCE(episodes.participants, '') AS episode_participants,
         COALESCE(episodes.summary, '') AS episode_summary
       FROM memories
       LEFT JOIN episodes ON episodes.id = memories.episode_id
       ORDER BY memories.timestamp DESC
       LIMIT ?`,
    ).all(MEMORY_SCAN_LIMIT);
  } finally {
    db.close();
  }
}

export function buildCausalMemoryRuntimeSnapshot(
  context: ActiveCausalContext,
  rows: MemoryBridgeRow[],
  now = new Date(),
): CausalMemoryRuntimeSnapshot {
  if (context.activeNodes.length === 0) {
    return {
      updatedAt: now.toISOString(),
      mode: "none",
      reason: "no active causal nodes",
      activeNodes: [],
      activeSources: context.activeSources,
      evaluatedCount: rows.length,
      candidateCount: 0,
      selectedMemoryCount: 0,
      selectedMemoryId: null,
      selectedMemoryScore: null,
      nodeOverlapCount: 0,
      recencyWeight: null,
      confidence: null,
      promptText: "",
      selectedMemory: null,
      topCandidates: [],
    };
  }

  const candidates = rows
    .map((row) => scoreCandidate(row, context, now))
    .filter((candidate): candidate is ScoredCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score);

  const selected = candidates[0] && candidates[0].score >= MIN_SELECTION_SCORE
    ? candidates[0]
    : null;

  if (!selected) {
    return {
      updatedAt: now.toISOString(),
      mode: "none",
      reason: candidates.length === 0
        ? "no memories intersected active causal nodes"
        : "top causal memory score stayed below selection threshold",
      activeNodes: context.activeNodes,
      activeSources: context.activeSources,
      evaluatedCount: rows.length,
      candidateCount: candidates.length,
      selectedMemoryCount: 0,
      selectedMemoryId: null,
      selectedMemoryScore: candidates[0]?.score ?? null,
      nodeOverlapCount: 0,
      recencyWeight: null,
      confidence: null,
      promptText: "",
      selectedMemory: null,
      topCandidates: summarizeTopCandidates(candidates),
    };
  }

  return {
    updatedAt: now.toISOString(),
    mode: "causal",
    reason: "selected one memory that overlaps current causal nodes",
    activeNodes: context.activeNodes,
    activeSources: context.activeSources,
    evaluatedCount: rows.length,
    candidateCount: candidates.length,
    selectedMemoryCount: 1,
    selectedMemoryId: selected.row.id,
    selectedMemoryScore: selected.score,
    nodeOverlapCount: selected.nodeOverlapCount,
    recencyWeight: selected.recencyWeight,
    confidence: selected.metadata.confidence,
    promptText: selected.promptText,
    selectedMemory: toSelection(selected),
    topCandidates: summarizeTopCandidates(candidates),
  };
}

export function resolveCausalMemoryRuntimePath(explicitPath?: string): string {
  return explicitPath
    ?? process.env.WARDROBE_CAUSAL_MEMORY_RUNTIME_PATH?.trim()
    ?? DEFAULT_CAUSAL_MEMORY_RUNTIME_PATH;
}

export async function saveCausalMemoryRuntimeSnapshot(
  snapshot: CausalMemoryRuntimeSnapshot,
  runtimePath?: string,
): Promise<void> {
  const resolvedPath = resolveCausalMemoryRuntimePath(runtimePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  await Bun.write(resolvedPath, JSON.stringify(snapshot, null, 2) + "\n");
}

export async function readCausalMemoryRuntimeSnapshot(
  runtimePath?: string,
): Promise<CausalMemoryRuntimeSnapshot | null> {
  const resolvedPath = resolveCausalMemoryRuntimePath(runtimePath);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) return null;

  try {
    return await file.json() as CausalMemoryRuntimeSnapshot;
  } catch {
    return null;
  }
}

export async function buildAndSaveCausalMemoryRuntimeSnapshot(options: {
  now?: Date;
  runtimePath?: string;
  memoryDbPath?: string;
  causalRuntime?: CausalRuntimeSnapshot | null;
} = {}): Promise<CausalMemoryRuntimeSnapshot> {
  const now = options.now ?? new Date();
  const causalRuntime = options.causalRuntime ?? await readCausalRuntimeSnapshot();
  const context = buildActiveCausalContext(causalRuntime);
  const dbPath = options.memoryDbPath ?? resolveMemoryDbPath({ scriptDir: import.meta.dir });

  let rows: MemoryBridgeRow[] = [];
  let snapshot: CausalMemoryRuntimeSnapshot;

  try {
    rows = readMemoryRows(dbPath);
    snapshot = buildCausalMemoryRuntimeSnapshot(context, rows, now);
  } catch (error) {
    snapshot = {
      updatedAt: now.toISOString(),
      mode: "none",
      reason: error instanceof Error ? error.message : String(error),
      activeNodes: context.activeNodes,
      activeSources: context.activeSources,
      evaluatedCount: 0,
      candidateCount: 0,
      selectedMemoryCount: 0,
      selectedMemoryId: null,
      selectedMemoryScore: null,
      nodeOverlapCount: 0,
      recencyWeight: null,
      confidence: null,
      promptText: "",
      selectedMemory: null,
      topCandidates: [],
    };
  }

  await saveCausalMemoryRuntimeSnapshot(snapshot, options.runtimePath);
  return snapshot;
}

export function renderCausalMemoryHint(snapshot: CausalMemoryRuntimeSnapshot | null): string {
  if (!snapshot || snapshot.selectedMemoryCount === 0 || !snapshot.promptText) {
    return "";
  }

  return `[memory-hint — 因果接続。参考にせよ、ただし直接言及するな]\n  - ${snapshot.promptText}`;
}

async function main() {
  const snapshot = await buildAndSaveCausalMemoryRuntimeSnapshot();
  const text = renderCausalMemoryHint(snapshot);
  if (!text) return;
  process.stdout.write(text);
}

if (import.meta.main) {
  await main();
}
