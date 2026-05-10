#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  inferAffectedNodes,
  inferMemoryValence,
  type MemoryValence,
} from "./causal-memory-bridge";
import { resolveMemoryDbPath } from "./memory-db-path";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_PENDING_LEARNED_EDGES_PATH = resolve(
  PROJECT_ROOT,
  ".claude/workingDirs/pending-learned-edges.json",
);
const DEFAULT_LEARNED_SEEDS_PATH = resolve(
  PROJECT_ROOT,
  ".claude/persona/learned-seeds.json",
);

export const PHASE5_NODE_IDS = [
  "mood",
  "energy",
  "health",
  "trust_mizuho",
  "satiation",
] as const;

export type Phase5NodeId = typeof PHASE5_NODE_IDS[number];
export type LearnedEdgeDirection = `${Phase5NodeId}->${Phase5NodeId}` | "ambiguous";
export type LearnedEdgeRelation = "lifts" | "drains" | "modulates";
export type LearnedEdgeStatus = "observing" | "confirmed";

const MEMORY_SCAN_LIMIT = 200;
const MIN_EVIDENCE_COUNT = 5;
const EVIDENCE_SUMMARY_LIMIT = 3;
const EVIDENCE_SNIPPET_LIMIT = 50;
const TIME_LEAD_THRESHOLD_HOURS = 6;

const SATIATION_HINTS = [
  "satiation",
  "充足",
  "満た",
  "満ち",
  "消化",
  "digest",
  "満腹",
  "空腹",
  "欲して",
] as const;

interface LearnerMemoryRow {
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

interface InferredLearnerMemory {
  row: LearnerMemoryRow;
  affectedNodes: Phase5NodeId[];
  valence: MemoryValence;
  timestampMs: number | null;
}

interface NodeTimeStats {
  count: number;
  meanTimestampMs: number | null;
}

export interface PendingEvidenceSummary {
  id: string;
  timestamp: string;
  valence: MemoryValence;
  contentSnippet: string;
}

export interface PendingLearnedEdgeCandidate {
  id: string;
  pair: [Phase5NodeId, Phase5NodeId];
  source: Phase5NodeId | null;
  target: Phase5NodeId | null;
  direction: LearnedEdgeDirection;
  evidenceCount: number;
  evidenceMemoryIds: string[];
  evidenceSummary: PendingEvidenceSummary[];
  positiveEvidenceCount: number;
  negativeEvidenceCount: number;
  neutralEvidenceCount: number;
  timeSignal: {
    leadNode: Phase5NodeId | null;
    lagNode: Phase5NodeId | null;
    deltaHours: number | null;
    averageTimestamps: Record<Phase5NodeId, string | null>;
  };
}

export interface PendingLearnedEdgesSnapshot {
  updatedAt: string;
  memoryDbPath: string;
  scanLimit: number;
  scannedMemoryCount: number;
  candidateCount: number;
  candidates: PendingLearnedEdgeCandidate[];
}

export interface LearnedSeedEdge {
  id: string;
  pair: [Phase5NodeId, Phase5NodeId];
  source: Phase5NodeId | null;
  target: Phase5NodeId | null;
  direction: LearnedEdgeDirection;
  relation: LearnedEdgeRelation;
  causalLevel: "Lv2";
  weight: number;
  status: LearnedEdgeStatus;
  evidenceCount: number;
  evidenceMemoryIds: string[];
  evidenceSummary: PendingEvidenceSummary[];
  positiveEvidenceCount: number;
  negativeEvidenceCount: number;
  neutralEvidenceCount: number;
  timeSignal: PendingLearnedEdgeCandidate["timeSignal"];
  learnedAt: string;
  lastUpdated: string;
  description: string;
}

export interface LearnedSeedsSnapshot {
  learnedEdges: LearnedSeedEdge[];
}

export interface PromotionResult {
  promotedCount: number;
  skippedCount: number;
  learnedEdges: LearnedSeedEdge[];
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function clipText(value: string, limit = EVIDENCE_SNIPPET_LIMIT): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}…`;
}

function isPhase5NodeId(value: string): value is Phase5NodeId {
  return (PHASE5_NODE_IDS as readonly string[]).includes(value);
}

function phase5NodeOrder(nodeId: Phase5NodeId): number {
  return PHASE5_NODE_IDS.indexOf(nodeId);
}

function canonicalizePair(left: Phase5NodeId, right: Phase5NodeId): [Phase5NodeId, Phase5NodeId] {
  return phase5NodeOrder(left) <= phase5NodeOrder(right)
    ? [left, right]
    : [right, left];
}

function pairKey(left: Phase5NodeId, right: Phase5NodeId): string {
  const [first, second] = canonicalizePair(left, right);
  return `${first}__${second}`;
}

function shouldAddSatiation(row: LearnerMemoryRow): boolean {
  const text = normalizeText(
    `${row.content}\n${row.episode_summary}\n${row.episode_participants}\n${row.tags}\n${row.category}\n${row.emotion}`,
  );
  return SATIATION_HINTS.some((hint) => text.includes(normalizeText(hint)));
}

export function inferPhase5AffectedNodes(row: LearnerMemoryRow): Phase5NodeId[] {
  const nodes = new Set<Phase5NodeId>();

  for (const nodeId of inferAffectedNodes(row)) {
    if (isPhase5NodeId(nodeId)) {
      nodes.add(nodeId);
    }
  }

  if (shouldAddSatiation(row)) {
    nodes.add("satiation");
  }

  return PHASE5_NODE_IDS.filter((nodeId) => nodes.has(nodeId));
}

function readLearnerMemoryRows(dbPath: string, limit = MEMORY_SCAN_LIMIT): LearnerMemoryRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.query<LearnerMemoryRow, [number]>(
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
    ).all(limit);
  } finally {
    db.close();
  }
}

function inferLearnerMemories(rows: LearnerMemoryRow[]): InferredLearnerMemory[] {
  return rows.map((row) => {
    const timestampMs = Date.parse(row.timestamp);
    return {
      row,
      affectedNodes: inferPhase5AffectedNodes(row),
      valence: inferMemoryValence(row),
      timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
    };
  });
}

function buildNodeTimeStats(memories: InferredLearnerMemory[]): Map<Phase5NodeId, NodeTimeStats> {
  const timestamps = new Map<Phase5NodeId, number[]>();

  for (const memory of memories) {
    if (memory.timestampMs == null) continue;

    for (const nodeId of memory.affectedNodes) {
      const values = timestamps.get(nodeId) ?? [];
      values.push(memory.timestampMs);
      timestamps.set(nodeId, values);
    }
  }

  const stats = new Map<Phase5NodeId, NodeTimeStats>();
  for (const nodeId of PHASE5_NODE_IDS) {
    const values = timestamps.get(nodeId) ?? [];
    const meanTimestampMs = values.length > 0
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
    stats.set(nodeId, {
      count: values.length,
      meanTimestampMs,
    });
  }

  return stats;
}

function countPairCooccurrences(
  memories: InferredLearnerMemory[],
): Map<string, InferredLearnerMemory[]> {
  const pairs = new Map<string, InferredLearnerMemory[]>();

  for (const memory of memories) {
    if (memory.affectedNodes.length < 2) continue;

    const uniqueNodes = [...new Set(memory.affectedNodes)]
      .sort((left, right) => phase5NodeOrder(left) - phase5NodeOrder(right));

    for (let leftIndex = 0; leftIndex < uniqueNodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < uniqueNodes.length; rightIndex += 1) {
        const left = uniqueNodes[leftIndex];
        const right = uniqueNodes[rightIndex];
        const key = pairKey(left, right);
        const evidence = pairs.get(key) ?? [];
        evidence.push(memory);
        pairs.set(key, evidence);
      }
    }
  }

  return pairs;
}

function timestampToIsoOrNull(value: number | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

export function estimateCandidateDirection(
  pair: [Phase5NodeId, Phase5NodeId],
  nodeStats: Map<Phase5NodeId, NodeTimeStats>,
  evidence: InferredLearnerMemory[],
): {
  direction: LearnedEdgeDirection;
  source: Phase5NodeId | null;
  target: Phase5NodeId | null;
  leadNode: Phase5NodeId | null;
  lagNode: Phase5NodeId | null;
  deltaHours: number | null;
} {
  const leftStats = nodeStats.get(pair[0]);
  const rightStats = nodeStats.get(pair[1]);
  const nonNeutralEvidenceCount = evidence.filter((entry) => entry.valence !== "neutral").length;

  if (
    !leftStats
    || !rightStats
    || leftStats.meanTimestampMs == null
    || rightStats.meanTimestampMs == null
    || nonNeutralEvidenceCount === 0
  ) {
    return {
      direction: "ambiguous",
      source: null,
      target: null,
      leadNode: null,
      lagNode: null,
      deltaHours: null,
    };
  }

  const deltaHours = Math.abs(leftStats.meanTimestampMs - rightStats.meanTimestampMs) / (1000 * 60 * 60);
  if (deltaHours < TIME_LEAD_THRESHOLD_HOURS) {
    return {
      direction: "ambiguous",
      source: null,
      target: null,
      leadNode: null,
      lagNode: null,
      deltaHours: Number(deltaHours.toFixed(2)),
    };
  }

  const source = leftStats.meanTimestampMs <= rightStats.meanTimestampMs ? pair[0] : pair[1];
  const target = source === pair[0] ? pair[1] : pair[0];

  return {
    direction: `${source}->${target}`,
    source,
    target,
    leadNode: source,
    lagNode: target,
    deltaHours: Number(deltaHours.toFixed(2)),
  };
}

function summarizeEvidence(evidence: InferredLearnerMemory[]): PendingEvidenceSummary[] {
  return [...evidence]
    .sort((left, right) => {
      const importanceDelta = right.row.importance - left.row.importance;
      if (importanceDelta !== 0) return importanceDelta;

      const leftTimestamp = left.timestampMs ?? Number.NEGATIVE_INFINITY;
      const rightTimestamp = right.timestampMs ?? Number.NEGATIVE_INFINITY;
      return rightTimestamp - leftTimestamp;
    })
    .slice(0, EVIDENCE_SUMMARY_LIMIT)
    .map((entry) => ({
      id: entry.row.id,
      timestamp: entry.row.timestamp,
      valence: entry.valence,
      contentSnippet: clipText(entry.row.content),
    }));
}

function buildCandidateId(pair: [Phase5NodeId, Phase5NodeId]): string {
  return `pending_${pair[0]}_${pair[1]}`;
}

function buildLearnedEdgeId(candidate: Pick<PendingLearnedEdgeCandidate, "pair" | "source" | "target">): string {
  const left = candidate.source ?? candidate.pair[0];
  const right = candidate.target ?? candidate.pair[1];
  return `learned_${left}_${right}_001`;
}

function buildCandidateIdentityKey(candidate: Pick<PendingLearnedEdgeCandidate, "pair" | "source" | "target">): string {
  if (candidate.source && candidate.target) {
    return `${candidate.source}->${candidate.target}`;
  }
  return `ambiguous:${candidate.pair[0]}->${candidate.pair[1]}`;
}

function buildLearnedEdgeIdentityKey(edge: Pick<LearnedSeedEdge, "pair" | "source" | "target">): string {
  if (edge.source && edge.target) {
    return `${edge.source}->${edge.target}`;
  }
  return `ambiguous:${edge.pair[0]}->${edge.pair[1]}`;
}

function inferLearnedRelation(candidate: Pick<
  PendingLearnedEdgeCandidate,
  "direction" | "positiveEvidenceCount" | "negativeEvidenceCount"
>): LearnedEdgeRelation {
  if (candidate.direction === "ambiguous") {
    return "modulates";
  }
  if (candidate.positiveEvidenceCount > candidate.negativeEvidenceCount) {
    return "lifts";
  }
  if (candidate.negativeEvidenceCount > candidate.positiveEvidenceCount) {
    return "drains";
  }
  return "modulates";
}

function buildLearnedDescription(candidate: PendingLearnedEdgeCandidate): string {
  const base = candidate.direction === "ambiguous"
    ? `${candidate.pair[0]} と ${candidate.pair[1]} の共起が ${candidate.evidenceCount} 件観測されたが、方向は未確定。`
    : `${candidate.source} から ${candidate.target} への経験起因エッジ候補が ${candidate.evidenceCount} 件観測された。`;

  const evidence = candidate.evidenceSummary[0]?.contentSnippet;
  return evidence ? `${base} 代表記憶: ${evidence}` : base;
}

function toLearnedSeedEdge(candidate: PendingLearnedEdgeCandidate, now = new Date()): LearnedSeedEdge {
  const timestamp = now.toISOString();
  return {
    id: buildLearnedEdgeId(candidate),
    pair: candidate.pair,
    source: candidate.source,
    target: candidate.target,
    direction: candidate.direction,
    relation: inferLearnedRelation(candidate),
    causalLevel: "Lv2",
    weight: 0.3,
    status: "observing",
    evidenceCount: candidate.evidenceCount,
    evidenceMemoryIds: candidate.evidenceMemoryIds,
    evidenceSummary: candidate.evidenceSummary,
    positiveEvidenceCount: candidate.positiveEvidenceCount,
    negativeEvidenceCount: candidate.negativeEvidenceCount,
    neutralEvidenceCount: candidate.neutralEvidenceCount,
    timeSignal: candidate.timeSignal,
    learnedAt: timestamp,
    lastUpdated: timestamp,
    description: buildLearnedDescription(candidate),
  };
}

export function buildPendingLearnedEdgesSnapshot(
  rows: LearnerMemoryRow[],
  options: {
    now?: Date;
    memoryDbPath: string;
    scanLimit?: number;
  },
): PendingLearnedEdgesSnapshot {
  const memories = inferLearnerMemories(rows);
  const nodeStats = buildNodeTimeStats(memories);
  const pairEvidence = countPairCooccurrences(memories);

  const candidates = [...pairEvidence.entries()]
    .map(([key, evidence]) => {
      const [left, right] = key.split("__") as [Phase5NodeId, Phase5NodeId];
      const pair = canonicalizePair(left, right);
      if (evidence.length < MIN_EVIDENCE_COUNT) {
        return null;
      }

      const positiveEvidenceCount = evidence.filter((entry) => entry.valence === "positive").length;
      const negativeEvidenceCount = evidence.filter((entry) => entry.valence === "negative").length;
      const neutralEvidenceCount = evidence.length - positiveEvidenceCount - negativeEvidenceCount;
      const direction = estimateCandidateDirection(pair, nodeStats, evidence);

      return {
        id: buildCandidateId(pair),
        pair,
        source: direction.source,
        target: direction.target,
        direction: direction.direction,
        evidenceCount: evidence.length,
        evidenceMemoryIds: evidence.map((entry) => entry.row.id),
        evidenceSummary: summarizeEvidence(evidence),
        positiveEvidenceCount,
        negativeEvidenceCount,
        neutralEvidenceCount,
        timeSignal: {
          leadNode: direction.leadNode,
          lagNode: direction.lagNode,
          deltaHours: direction.deltaHours,
          averageTimestamps: {
            [pair[0]]: timestampToIsoOrNull(nodeStats.get(pair[0])?.meanTimestampMs ?? null),
            [pair[1]]: timestampToIsoOrNull(nodeStats.get(pair[1])?.meanTimestampMs ?? null),
          } as Record<Phase5NodeId, string | null>,
        },
      } satisfies PendingLearnedEdgeCandidate;
    })
    .filter((candidate): candidate is PendingLearnedEdgeCandidate => candidate !== null)
    .sort((left, right) => {
      if (right.evidenceCount !== left.evidenceCount) {
        return right.evidenceCount - left.evidenceCount;
      }

      return left.id.localeCompare(right.id);
    });

  return {
    updatedAt: (options.now ?? new Date()).toISOString(),
    memoryDbPath: options.memoryDbPath,
    scanLimit: options.scanLimit ?? MEMORY_SCAN_LIMIT,
    scannedMemoryCount: rows.length,
    candidateCount: candidates.length,
    candidates,
  };
}

export function resolvePendingLearnedEdgesPath(explicitPath?: string): string {
  return explicitPath
    ?? process.env.WARDROBE_PENDING_LEARNED_EDGES_PATH?.trim()
    ?? DEFAULT_PENDING_LEARNED_EDGES_PATH;
}

export function resolveLearnedSeedsPath(explicitPath?: string): string {
  return explicitPath
    ?? process.env.WARDROBE_LEARNED_SEEDS_PATH?.trim()
    ?? DEFAULT_LEARNED_SEEDS_PATH;
}

export async function readPendingLearnedEdgesSnapshot(
  inputPath?: string,
): Promise<PendingLearnedEdgesSnapshot | null> {
  const resolvedPath = resolvePendingLearnedEdgesPath(inputPath);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) return null;

  try {
    return await file.json() as PendingLearnedEdgesSnapshot;
  } catch {
    return null;
  }
}

export async function readLearnedSeedsSnapshot(
  inputPath?: string,
): Promise<LearnedSeedsSnapshot> {
  const resolvedPath = resolveLearnedSeedsPath(inputPath);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) {
    return { learnedEdges: [] };
  }

  try {
    const parsed = await file.json() as Partial<LearnedSeedsSnapshot> | null;
    return {
      learnedEdges: parsed?.learnedEdges ?? [],
    };
  } catch {
    return { learnedEdges: [] };
  }
}

export async function savePendingLearnedEdgesSnapshot(
  snapshot: PendingLearnedEdgesSnapshot,
  outputPath?: string,
): Promise<void> {
  const resolvedPath = resolvePendingLearnedEdgesPath(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  await Bun.write(resolvedPath, JSON.stringify(snapshot, null, 2) + "\n");
}

export async function saveLearnedSeedsSnapshot(
  snapshot: LearnedSeedsSnapshot,
  outputPath?: string,
): Promise<void> {
  const resolvedPath = resolveLearnedSeedsPath(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  await Bun.write(resolvedPath, JSON.stringify(snapshot, null, 2) + "\n");
}

export async function extractPendingLearnedEdgesSnapshot(options: {
  now?: Date;
  memoryDbPath?: string;
  scanLimit?: number;
} = {}): Promise<PendingLearnedEdgesSnapshot> {
  const memoryDbPath = options.memoryDbPath ?? resolveMemoryDbPath({ scriptDir: import.meta.dir });
  const rows = readLearnerMemoryRows(memoryDbPath, options.scanLimit ?? MEMORY_SCAN_LIMIT);
  return buildPendingLearnedEdgesSnapshot(rows, {
    now: options.now,
    memoryDbPath,
    scanLimit: options.scanLimit,
  });
}

export function promotePendingCandidatesToLearnedSeeds(
  pending: PendingLearnedEdgesSnapshot,
  existing: LearnedSeedsSnapshot,
  options: {
    now?: Date;
  } = {},
): PromotionResult {
  const learnedEdges = [...existing.learnedEdges];
  const existingKeys = new Set(learnedEdges.map((edge) => buildLearnedEdgeIdentityKey(edge)));
  let promotedCount = 0;
  let skippedCount = 0;

  for (const candidate of pending.candidates) {
    const key = buildCandidateIdentityKey(candidate);
    if (existingKeys.has(key)) {
      skippedCount += 1;
      continue;
    }

    learnedEdges.push(toLearnedSeedEdge(candidate, options.now));
    existingKeys.add(key);
    promotedCount += 1;
  }

  learnedEdges.sort((left, right) => left.id.localeCompare(right.id));

  return {
    promotedCount,
    skippedCount,
    learnedEdges,
  };
}

export async function buildAndSavePendingLearnedEdgesSnapshot(options: {
  now?: Date;
  outputPath?: string;
  memoryDbPath?: string;
  scanLimit?: number;
} = {}): Promise<PendingLearnedEdgesSnapshot> {
  const snapshot = await extractPendingLearnedEdgesSnapshot({
    now: options.now,
    memoryDbPath: options.memoryDbPath,
    scanLimit: options.scanLimit,
  });
  await savePendingLearnedEdgesSnapshot(snapshot, options.outputPath);
  return snapshot;
}

export async function promotePendingLearnedEdgesSnapshot(options: {
  now?: Date;
  pendingPath?: string;
  learnedSeedsPath?: string;
  pendingSnapshot?: PendingLearnedEdgesSnapshot;
} = {}): Promise<PromotionResult> {
  const pendingSnapshot = options.pendingSnapshot ?? await readPendingLearnedEdgesSnapshot(options.pendingPath);
  if (!pendingSnapshot) {
    return {
      promotedCount: 0,
      skippedCount: 0,
      learnedEdges: [],
    };
  }

  const existing = await readLearnedSeedsSnapshot(options.learnedSeedsPath);
  const result = promotePendingCandidatesToLearnedSeeds(pendingSnapshot, existing, {
    now: options.now,
  });

  await saveLearnedSeedsSnapshot({ learnedEdges: result.learnedEdges }, options.learnedSeedsPath);
  return result;
}

export async function buildAndPromotePendingLearnedEdgesSnapshot(options: {
  now?: Date;
  outputPath?: string;
  memoryDbPath?: string;
  scanLimit?: number;
  learnedSeedsPath?: string;
} = {}): Promise<{
  pending: PendingLearnedEdgesSnapshot;
  promotion: PromotionResult;
}> {
  const pending = await buildAndSavePendingLearnedEdgesSnapshot({
    now: options.now,
    outputPath: options.outputPath,
    memoryDbPath: options.memoryDbPath,
    scanLimit: options.scanLimit,
  });
  const promotion = await promotePendingLearnedEdgesSnapshot({
    now: options.now,
    pendingSnapshot: pending,
    learnedSeedsPath: options.learnedSeedsPath,
  });
  return { pending, promotion };
}

async function main() {
  const args = new Set(Bun.argv.slice(2));

  if (args.has("--dry-run") || args.has("--candidates")) {
    const snapshot = await extractPendingLearnedEdgesSnapshot();
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  if (args.has("--promote-pending")) {
    const result = await promotePendingLearnedEdgesSnapshot();
    console.log(JSON.stringify({
      promotedCount: result.promotedCount,
      skippedCount: result.skippedCount,
      learnedSeedsPath: resolveLearnedSeedsPath(),
    }, null, 2));
    return;
  }

  if (args.has("--promote-all")) {
    const { pending, promotion } = await buildAndPromotePendingLearnedEdgesSnapshot();
    console.log(JSON.stringify({
      updatedAt: pending.updatedAt,
      candidateCount: pending.candidateCount,
      scannedMemoryCount: pending.scannedMemoryCount,
      outputPath: resolvePendingLearnedEdgesPath(),
      promotedCount: promotion.promotedCount,
      skippedCount: promotion.skippedCount,
      learnedSeedsPath: resolveLearnedSeedsPath(),
    }, null, 2));
    return;
  }

  const snapshot = await buildAndSavePendingLearnedEdgesSnapshot();
  console.log(JSON.stringify({
    updatedAt: snapshot.updatedAt,
    candidateCount: snapshot.candidateCount,
    scannedMemoryCount: snapshot.scannedMemoryCount,
    outputPath: resolvePendingLearnedEdgesPath(),
  }, null, 2));
}

if (import.meta.main) {
  await main();
}
