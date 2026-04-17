#!/usr/bin/env bun

import { parseArgs } from "node:util";

import {
  PERSONA_KUZU_DB_PATH,
  readKuzuCausalGraphSnapshot,
  readKuzuCausalNode,
  readKuzuTraceBundle,
} from "./causal-kuzu";

function toCountMap(values: Array<string | null>): Record<string, number> {
  const counts = new Map<string, number>();

  for (const value of values) {
    const key = value ?? "(none)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return Object.fromEntries(
    Array.from(counts.entries()).sort(([left], [right]) => left.localeCompare(right, "ja")),
  );
}

function printUsage(): void {
  console.log(`Usage:
  bun .claude/scripts/causal-kuzu-inspect.ts summary
  bun .claude/scripts/causal-kuzu-inspect.ts snapshot
  bun .claude/scripts/causal-kuzu-inspect.ts node <key>
  bun .claude/scripts/causal-kuzu-inspect.ts trace <key> [--direction=both] [--depth=3]
`);
}

async function runSummary(): Promise<void> {
  const snapshot = await readKuzuCausalGraphSnapshot();

  console.log(JSON.stringify({
    dbPath: PERSONA_KUZU_DB_PATH,
    counts: {
      nodes: snapshot.nodes.length,
      edges: snapshot.edges.length,
    },
    nodeKinds: toCountMap(snapshot.nodes.map((node) => node.kind)),
    dataLevels: toCountMap(snapshot.nodes.map((node) => node.dataLevel)),
    causalLevels: toCountMap(snapshot.edges.map((edge) => edge.causalLevel)),
    sampleNodes: snapshot.nodes.slice(0, 12).map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      dataLevel: node.dataLevel,
    })),
  }, null, 2));
}

async function runSnapshot(): Promise<void> {
  const snapshot = await readKuzuCausalGraphSnapshot();
  console.log(JSON.stringify({
    dbPath: PERSONA_KUZU_DB_PATH,
    ...snapshot,
  }, null, 2));
}

async function runNode(key: string): Promise<void> {
  const [snapshot, node] = await Promise.all([
    readKuzuCausalGraphSnapshot(),
    readKuzuCausalNode(key),
  ]);

  if (!node) {
    throw new Error(`Node not found: ${key}`);
  }

  const incoming = snapshot.edges.filter((edge) => edge.targetId === key);
  const outgoing = snapshot.edges.filter((edge) => edge.sourceId === key);

  console.log(JSON.stringify({
    dbPath: PERSONA_KUZU_DB_PATH,
    node,
    incoming,
    outgoing,
  }, null, 2));
}

async function runTrace(
  key: string,
  direction: "upstream" | "downstream" | "both",
  depth: number,
): Promise<void> {
  const bundle = await readKuzuTraceBundle(key, direction, depth);

  console.log(JSON.stringify({
    dbPath: PERSONA_KUZU_DB_PATH,
    key,
    direction,
    depth,
    startNode: bundle.startNode,
    graphCounts: {
      nodes: bundle.graph.nodes.length,
      edges: bundle.graph.edges.length,
    },
    upstreamRows: bundle.upstreamRows,
    downstreamRows: bundle.downstreamRows,
  }, null, 2));
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      direction: {
        type: "string",
        default: "both",
      },
      depth: {
        type: "string",
        default: "3",
      },
    },
  });

  const command = positionals[0] ?? "summary";
  const key = positionals[1];
  const direction = values.direction === "upstream" || values.direction === "downstream" || values.direction === "both"
    ? values.direction
    : "both";
  const depthNumber = Number(values.depth);
  const depth = Number.isFinite(depthNumber) ? Math.max(1, Math.min(6, Math.trunc(depthNumber))) : 3;

  if (command === "help" || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command === "summary") {
    await runSummary();
    process.exit(0);
  }

  if (command === "snapshot") {
    await runSnapshot();
    process.exit(0);
  }

  if (command === "node") {
    if (!key) {
      printUsage();
      throw new Error("node command requires <key>");
    }
    await runNode(key);
    process.exit(0);
  }

  if (command === "trace") {
    if (!key) {
      printUsage();
      throw new Error("trace command requires <key>");
    }
    await runTrace(key, direction, depth);
    process.exit(0);
  }

  printUsage();
  throw new Error(`Unknown command: ${command}`);
}
