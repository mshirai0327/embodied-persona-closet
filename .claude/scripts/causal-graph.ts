#!/usr/bin/env bun

import { Database } from "bun:sqlite";

import { PERSONA_DB_PATH, syncPersonaStructuredStore } from "./persona-data";

export type TraceDirection = "upstream" | "downstream" | "both";

export interface CausalNodeRecord {
  id: string;
  label: string;
  kind: string;
  dataLevel: string | null;
  description: string | null;
}

export interface CausalEdgeRecord {
  sourceId: string;
  targetId: string;
  relation: string;
  causalLevel: string;
  weight: number;
  description: string | null;
}

export interface CurrentMetricRecord {
  key: string;
  label: string;
  level: string;
  valueText: string | null;
  valueNumber: number | null;
  unit: string | null;
  reason: string | null;
}

export interface TraceNode extends CausalNodeRecord {
  currentMetric: CurrentMetricRecord | null;
  role: "origin" | "upstream" | "downstream";
}

export interface TraceEdge extends CausalEdgeRecord {
  direction: Exclude<TraceDirection, "both">;
  depth: number;
}

export interface TraceChain {
  direction: Exclude<TraceDirection, "both">;
  terminalId: string;
  terminalLabel: string;
  depth: number;
  score: number;
  nodeIds: string[];
  labels: string[];
  edges: TraceEdge[];
}

export interface CausalTraceResult {
  startKey: string;
  direction: TraceDirection;
  maxDepth: number;
  startNode: TraceNode | null;
  nodes: TraceNode[];
  edges: TraceEdge[];
  upstream: TraceChain[];
  downstream: TraceChain[];
}

interface TraceGraphInput {
  nodes: CausalNodeRecord[];
  edges: CausalEdgeRecord[];
  currentMetrics?: CurrentMetricRecord[];
}

interface WalkState {
  currentId: string;
  nodeIds: string[];
  edges: TraceEdge[];
  score: number;
}

function chainScore(weights: number[]): number {
  if (weights.length === 0) return 1;
  return Number((weights.reduce((sum, value) => sum + value, 0) / weights.length).toFixed(3));
}

function metricMap(metrics: CurrentMetricRecord[] = []): Map<string, CurrentMetricRecord> {
  return new Map(metrics.map((metric) => [metric.key, metric]));
}

function bestChainByTerminal(chains: TraceChain[]): TraceChain[] {
  const best = new Map<string, TraceChain>();

  for (const chain of chains) {
    const current = best.get(chain.terminalId);
    if (!current) {
      best.set(chain.terminalId, chain);
      continue;
    }

    if (chain.depth < current.depth || (chain.depth === current.depth && chain.score > current.score)) {
      best.set(chain.terminalId, chain);
    }
  }

  return Array.from(best.values()).sort((left, right) => {
    if (left.depth !== right.depth) return left.depth - right.depth;
    if (right.score !== left.score) return right.score - left.score;
    return left.terminalLabel.localeCompare(right.terminalLabel, "ja");
  });
}

function traceDirection(
  graph: TraceGraphInput,
  startKey: string,
  direction: Exclude<TraceDirection, "both">,
  maxDepth: number,
): TraceChain[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacency = new Map<string, CausalEdgeRecord[]>();

  for (const edge of graph.edges) {
    const bucketKey = direction === "upstream" ? edge.targetId : edge.sourceId;
    const bucket = adjacency.get(bucketKey) ?? [];
    bucket.push(edge);
    adjacency.set(bucketKey, bucket);
  }

  const chains: TraceChain[] = [];
  const queue: WalkState[] = [{
    currentId: startKey,
    nodeIds: [startKey],
    edges: [],
    score: 1,
  }];

  while (queue.length > 0) {
    const state = queue.shift();
    if (!state) continue;
    if (state.edges.length >= maxDepth) continue;

    for (const edge of adjacency.get(state.currentId) ?? []) {
      const nextId = direction === "upstream" ? edge.sourceId : edge.targetId;
      if (state.nodeIds.includes(nextId)) continue;

      const nextEdge: TraceEdge = {
        ...edge,
        direction,
        depth: state.edges.length + 1,
      };
      const nextNodeIds = [...state.nodeIds, nextId];
      const nextEdges = [...state.edges, nextEdge];
      const nextScore = chainScore(nextEdges.map((item) => item.weight));
      const labels = nextNodeIds.map((nodeId) => nodeById.get(nodeId)?.label ?? nodeId);
      const terminalNode = nodeById.get(nextId);

      chains.push({
        direction,
        terminalId: nextId,
        terminalLabel: terminalNode?.label ?? nextId,
        depth: nextEdges.length,
        score: nextScore,
        nodeIds: nextNodeIds,
        labels,
        edges: nextEdges,
      });

      queue.push({
        currentId: nextId,
        nodeIds: nextNodeIds,
        edges: nextEdges,
        score: nextScore,
      });
    }
  }

  return bestChainByTerminal(chains);
}

export function traceCausalGraph(
  graph: TraceGraphInput,
  startKey: string,
  options: { direction?: TraceDirection; maxDepth?: number } = {},
): CausalTraceResult {
  const direction = options.direction ?? "both";
  const maxDepth = Math.max(1, options.maxDepth ?? 3);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const metricsByKey = metricMap(graph.currentMetrics);

  const upstream = direction === "downstream"
    ? []
    : traceDirection(graph, startKey, "upstream", maxDepth);
  const downstream = direction === "upstream"
    ? []
    : traceDirection(graph, startKey, "downstream", maxDepth);

  const tracedNodeIds = new Set<string>([startKey]);
  const tracedEdges = new Map<string, TraceEdge>();

  for (const chain of [...upstream, ...downstream]) {
    for (const nodeId of chain.nodeIds) {
      tracedNodeIds.add(nodeId);
    }
    for (const edge of chain.edges) {
      const edgeKey = `${edge.direction}:${edge.sourceId}:${edge.targetId}:${edge.relation}`;
      const current = tracedEdges.get(edgeKey);
      if (!current || edge.depth < current.depth) {
        tracedEdges.set(edgeKey, edge);
      }
    }
  }

  const nodes: TraceNode[] = Array.from(tracedNodeIds)
    .map((nodeId) => {
      const node = nodesById.get(nodeId);
      if (!node) return null;

      let role: TraceNode["role"] = "origin";
      if (nodeId !== startKey) {
        role = upstream.some((chain) => chain.terminalId === nodeId || chain.nodeIds.includes(nodeId))
          ? "upstream"
          : "downstream";
      }

      return {
        ...node,
        currentMetric: metricsByKey.get(nodeId) ?? null,
        role,
      };
    })
    .filter((node): node is TraceNode => node !== null)
    .sort((left, right) => {
      if (left.id === startKey) return -1;
      if (right.id === startKey) return 1;
      return left.label.localeCompare(right.label, "ja");
    });

  const startNode = nodes.find((node) => node.id === startKey) ?? null;

  return {
    startKey,
    direction,
    maxDepth,
    startNode,
    nodes,
    edges: Array.from(tracedEdges.values()).sort((left, right) => {
      if (left.depth !== right.depth) return left.depth - right.depth;
      return left.sourceId.localeCompare(right.sourceId, "ja");
    }),
    upstream,
    downstream,
  };
}

export async function readCausalTrace(
  startKey: string,
  options: { direction?: TraceDirection; maxDepth?: number } = {},
): Promise<CausalTraceResult> {
  await syncPersonaStructuredStore();

  const db = new Database(PERSONA_DB_PATH, { readonly: true });

  try {
    const nodes = db
      .query<CausalNodeRecord, []>(
        `SELECT id, label, kind, data_level AS dataLevel, description
         FROM causal_nodes
         ORDER BY id`
      )
      .all();
    const edges = db
      .query<CausalEdgeRecord, []>(
        `SELECT source_id AS sourceId, target_id AS targetId, relation,
                causal_level AS causalLevel, weight, description
         FROM causal_edges
         ORDER BY source_id, target_id, relation`
      )
      .all();
    const currentMetrics = db
      .query<CurrentMetricRecord, []>(
        `SELECT key, label, level, value_text AS valueText, value_number AS valueNumber,
                unit, reason
         FROM persona_current`
      )
      .all();

    return traceCausalGraph(
      { nodes, edges, currentMetrics },
      startKey,
      options,
    );
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const startKey = Bun.argv[2] ?? "energy";
  const result = await readCausalTrace(startKey);
  console.log(JSON.stringify(result, null, 2));
}
