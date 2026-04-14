#!/usr/bin/env bun

import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type {
  CausalLevel,
  CausalNodeKind,
  PersonaLevel,
} from "./persona-data";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const NODE_HELPER_PATH = resolve(SCRIPT_DIR, "causal-kuzu-node.mjs");
const NODE_BIN = process.env.WARDROBE_NODE_BIN?.trim() || "node";

const DEFAULT_CAUSAL_SEED_PATH =
  process.env.WARDROBE_CAUSAL_SEED_PATH?.trim()
  ?? resolve(PROJECT_ROOT, ".claude/persona/causal-seeds.json");

export const PERSONA_KUZU_DB_PATH =
  process.env.WARDROBE_PERSONA_KUZU_DB_PATH?.trim()
  ?? resolve(PROJECT_ROOT, ".claude/workingDirs/persona-causal.kuzu");

export interface KuzuCausalNodeRow {
  id: string;
  label: string;
  kind: CausalNodeKind;
  dataLevel: PersonaLevel | null;
  description: string | null;
}

export interface KuzuCausalEdgeRow {
  sourceId: string;
  targetId: string;
  relation: string;
  causalLevel: CausalLevel;
  weight: number;
  description: string | null;
}

export interface KuzuCausalPathRow {
  terminalId: string;
  middleNodeIds: string[];
  relations: string[];
  causalLevels: CausalLevel[];
  weights: number[];
  descriptions: Array<string | null>;
}

export interface KuzuTraceBundle {
  graph: {
    nodes: KuzuCausalNodeRow[];
    edges: KuzuCausalEdgeRow[];
  };
  startNode: KuzuCausalNodeRow | null;
  upstreamRows: KuzuCausalPathRow[];
  downstreamRows: KuzuCausalPathRow[];
}

export type KuzuTraceDirection = "upstream" | "downstream";

async function spawnKuzuCommand<T>(
  command: string,
  payload: unknown,
  dbPath: string,
): Promise<T> {
  const proc = Bun.spawn([NODE_BIN, NODE_HELPER_PATH, command, JSON.stringify(payload ?? null)], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      WARDROBE_CAUSAL_SEED_PATH: DEFAULT_CAUSAL_SEED_PATH,
      WARDROBE_PERSONA_KUZU_DB_PATH: dbPath,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `kuzu helper exited with code ${exitCode}`);
  }

  const trimmed = stdout.trim();
  return trimmed ? JSON.parse(trimmed) as T : null as T;
}

function isKuzuLockError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Could not set lock on file");
}

async function runKuzuCommand<T>(command: string, payload: unknown = null): Promise<T> {
  try {
    return await spawnKuzuCommand<T>(command, payload, PERSONA_KUZU_DB_PATH);
  } catch (error) {
    if (command === "sync" || !isKuzuLockError(error)) {
      throw error;
    }

    const tempDir = await mkdtemp(`${tmpdir()}/persona-kuzu-read-`);
    const tempDbPath = `${tempDir}/persona-causal.kuzu`;

    try {
      await copyFile(PERSONA_KUZU_DB_PATH, tempDbPath);
      return await spawnKuzuCommand<T>(command, payload, tempDbPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export async function syncKuzuCausalGraph(): Promise<void> {
  await runKuzuCommand("sync");
}

export async function readKuzuCausalGraphSnapshot(): Promise<{
  nodes: KuzuCausalNodeRow[];
  edges: KuzuCausalEdgeRow[];
}> {
  return runKuzuCommand("snapshot");
}

export async function readKuzuCausalNode(nodeId: string): Promise<KuzuCausalNodeRow | null> {
  return runKuzuCommand("node", { nodeId });
}

export async function readKuzuCausalPathRows(
  startKey: string,
  direction: KuzuTraceDirection,
  maxDepth: number,
): Promise<KuzuCausalPathRow[]> {
  return runKuzuCommand("paths", { startKey, direction, maxDepth });
}

export async function readKuzuTraceBundle(
  startKey: string,
  direction: "upstream" | "downstream" | "both",
  maxDepth: number,
): Promise<KuzuTraceBundle> {
  return runKuzuCommand("trace", { startKey, direction, maxDepth });
}

if (import.meta.main) {
  await syncKuzuCausalGraph();
  const snapshot = await readKuzuCausalGraphSnapshot();
  console.log(JSON.stringify({
    dbPath: PERSONA_KUZU_DB_PATH,
    nodes: snapshot.nodes.length,
    edges: snapshot.edges.length,
  }, null, 2));
}
