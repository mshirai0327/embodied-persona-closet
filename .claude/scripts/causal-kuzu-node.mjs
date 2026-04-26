#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, Database } from "kuzu";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_CAUSAL_SEED_PATH =
  process.env.WARDROBE_CAUSAL_SEED_PATH?.trim()
  ?? resolve(PROJECT_ROOT, ".claude/persona/causal-seeds.json");
const DEFAULT_LEARNED_SEEDS_PATH =
  process.env.WARDROBE_LEARNED_SEEDS_PATH?.trim()
  ?? resolve(PROJECT_ROOT, ".claude/persona/learned-seeds.json");
const PERSONA_KUZU_DB_PATH =
  process.env.WARDROBE_PERSONA_KUZU_DB_PATH?.trim()
  ?? resolve(PROJECT_ROOT, ".claude/workingDirs/persona-causal.kuzu");

const DEFAULT_LEARNED_NODE_META = {
  mood: { label: "mood", kind: "emotion", dataLevel: "Lv3-2", description: null },
  energy: { label: "energy", kind: "emotion", dataLevel: "Lv3-2", description: null },
  health: { label: "health", kind: "emotion", dataLevel: "Lv3-2", description: null },
  trust_mizuho: { label: "trust_mizuho", kind: "emotion", dataLevel: "Lv3-2", description: null },
  satiation: { label: "satiation", kind: "emotion", dataLevel: "Lv3-2", description: null },
};

function normalizeStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => String(value));
}

function normalizeNullableStringArray(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => (value == null ? null : String(value)));
}

function normalizeNumberArray(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => Number(value));
}

function readJsonArg() {
  const raw = process.argv[3];
  if (!raw) return null;
  return JSON.parse(raw);
}

function cleanId(value) {
  const id = String(value ?? "").trim();
  return id ? id : null;
}

function normalizeWeight(value) {
  const weight = Number(value);
  return Number.isFinite(weight) ? weight : 0.3;
}

function sourceTargetKey(source, target) {
  return `${source}->${target}`;
}

function edgeIdentityKey(edge) {
  return `${edge.source}->${edge.target}:${edge.relation}`;
}

function fallbackLearnedNode(id) {
  const meta = DEFAULT_LEARNED_NODE_META[id] ?? {
    label: id,
    kind: "latent",
    dataLevel: null,
    description: null,
  };
  return {
    id,
    ...meta,
    sourceType: "learned",
  };
}

async function readJsonFile(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function readMergedGraph() {
  const seed = await readJsonFile(DEFAULT_CAUSAL_SEED_PATH) ?? { nodes: [], edges: [] };
  const learned = await readJsonFile(DEFAULT_LEARNED_SEEDS_PATH) ?? { learnedEdges: [] };
  const nodes = new Map();
  const edges = new Map();
  const seedPairs = new Set();
  const learnedPairs = new Set();

  for (const node of seed.nodes ?? []) {
    const id = cleanId(node.id);
    if (!id) continue;
    nodes.set(id, {
      id,
      label: node.label,
      kind: node.kind,
      dataLevel: node.dataLevel,
      description: node.description ?? null,
      sourceType: "seed",
    });
  }

  for (const edge of seed.edges ?? []) {
    const source = cleanId(edge.source);
    const target = cleanId(edge.target);
    if (!source || !target) continue;
    const normalizedEdge = {
      source,
      target,
      relation: edge.relation,
      causalLevel: edge.causalLevel,
      weight: normalizeWeight(edge.weight),
      description: edge.description ?? null,
      sourceType: "seed",
    };
    seedPairs.add(sourceTargetKey(source, target));
    edges.set(edgeIdentityKey(normalizedEdge), normalizedEdge);
  }

  for (const edge of learned.learnedEdges ?? []) {
    const status = String(edge.status ?? "observing").trim() || "observing";
    if (status !== "observing" && status !== "confirmed") continue;
    if (edge.direction === "ambiguous") continue;

    const source = cleanId(edge.source);
    const target = cleanId(edge.target);
    if (!source || !target) continue;

    const pairKey = sourceTargetKey(source, target);
    if (seedPairs.has(pairKey) || learnedPairs.has(pairKey)) continue;

    if (!nodes.has(source)) nodes.set(source, fallbackLearnedNode(source));
    if (!nodes.has(target)) nodes.set(target, fallbackLearnedNode(target));

    const normalizedEdge = {
      source,
      target,
      relation: edge.relation ?? "modulates",
      causalLevel: edge.causalLevel ?? "Lv2",
      weight: normalizeWeight(edge.weight),
      description: edge.description ?? null,
      sourceType: "learned",
    };
    edges.set(edgeIdentityKey(normalizedEdge), normalizedEdge);
    learnedPairs.add(pairKey);
  }

  return {
    nodes: Array.from(nodes.values()).sort((left, right) => left.id.localeCompare(right.id)),
    edges: Array.from(edges.values()).sort((left, right) => {
      if (left.sourceType !== right.sourceType) {
        return left.sourceType === "seed" ? -1 : 1;
      }
      if (left.source !== right.source) return left.source.localeCompare(right.source);
      if (left.target !== right.target) return left.target.localeCompare(right.target);
      return left.relation.localeCompare(right.relation);
    }),
  };
}

async function openKuzuConnection() {
  mkdirSync(dirname(PERSONA_KUZU_DB_PATH), { recursive: true });
  const db = new Database(PERSONA_KUZU_DB_PATH);
  const conn = new Connection(db);
  return { db, conn };
}

async function ensureKuzuSchema(conn) {
  await conn.query(`
    CREATE NODE TABLE IF NOT EXISTS CausalNode(
      id STRING,
      label STRING,
      kind STRING,
      dataLevel STRING,
      description STRING,
      sourceType STRING,
      PRIMARY KEY (id)
    );
  `);
  await conn.query(`
    CREATE REL TABLE IF NOT EXISTS CAUSES(
      FROM CausalNode TO CausalNode,
      relation STRING,
      causalLevel STRING,
      weight DOUBLE,
      description STRING,
      sourceType STRING
    );
  `);
}

async function clearKuzuGraph(conn) {
  await conn.query("MATCH ()-[edge:CAUSES]->() DELETE edge;");
  await conn.query("MATCH (node:CausalNode) DELETE node;");
}

async function readSnapshot(conn) {
  const nodeResult = await conn.query(`
    MATCH (node:CausalNode)
    RETURN
      node.id AS id,
      node.label AS label,
      node.kind AS kind,
      node.dataLevel AS dataLevel,
      node.description AS description,
      node.sourceType AS sourceType
    ORDER BY node.kind, node.id;
  `);
  const edgeResult = await conn.query(`
    MATCH (source:CausalNode)-[edge:CAUSES]->(target:CausalNode)
    RETURN
      source.id AS sourceId,
      target.id AS targetId,
      edge.relation AS relation,
      edge.causalLevel AS causalLevel,
      edge.weight AS weight,
      edge.description AS description,
      edge.sourceType AS sourceType
    ORDER BY edge.causalLevel, source.id, target.id;
  `);

  return {
    nodes: (await nodeResult.getAll()).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      kind: String(row.kind),
      dataLevel: row.dataLevel == null ? null : String(row.dataLevel),
      description: row.description == null ? null : String(row.description),
      sourceType: row.sourceType == null ? null : String(row.sourceType),
    })),
    edges: (await edgeResult.getAll()).map((row) => ({
      sourceId: String(row.sourceId),
      targetId: String(row.targetId),
      relation: String(row.relation),
      causalLevel: String(row.causalLevel),
      weight: Number(row.weight),
      description: row.description == null ? null : String(row.description),
      sourceType: row.sourceType == null ? null : String(row.sourceType),
    })),
  };
}

async function readNode(conn, nodeId) {
  const statement = await conn.prepare(`
    MATCH (node:CausalNode)
    WHERE node.id = $nodeId
    RETURN
      node.id AS id,
      node.label AS label,
      node.kind AS kind,
      node.dataLevel AS dataLevel,
      node.description AS description,
      node.sourceType AS sourceType
    LIMIT 1;
  `);
  const result = await conn.execute(statement, { nodeId });
  const row = (await result.getAll())[0];
  if (!row) return null;

  return {
    id: String(row.id),
    label: String(row.label),
    kind: String(row.kind),
    dataLevel: row.dataLevel == null ? null : String(row.dataLevel),
    description: row.description == null ? null : String(row.description),
    sourceType: row.sourceType == null ? null : String(row.sourceType),
  };
}

async function readPathRows(conn, startKey, direction, maxDepth) {
  const boundedDepth = Math.max(1, Math.min(6, Math.trunc(maxDepth ?? 3)));
  const recursiveMatch = direction === "upstream"
    ? `
      MATCH (terminal:CausalNode)-[path:CAUSES* acyclic 1..${boundedDepth}]->(origin:CausalNode)
      WHERE origin.id = $startKey
      RETURN
        terminal.id AS terminalId,
        properties(nodes(path), 'id') AS middleNodeIds,
        properties(rels(path), 'relation') AS relations,
        properties(rels(path), 'causalLevel') AS causalLevels,
        properties(rels(path), 'weight') AS weights,
        properties(rels(path), 'description') AS descriptions;
    `
    : `
      MATCH (origin:CausalNode)-[path:CAUSES* acyclic 1..${boundedDepth}]->(terminal:CausalNode)
      WHERE origin.id = $startKey
      RETURN
        terminal.id AS terminalId,
        properties(nodes(path), 'id') AS middleNodeIds,
        properties(rels(path), 'relation') AS relations,
        properties(rels(path), 'causalLevel') AS causalLevels,
        properties(rels(path), 'weight') AS weights,
        properties(rels(path), 'description') AS descriptions;
    `;

  const statement = await conn.prepare(recursiveMatch);
  const result = await conn.execute(statement, { startKey });

  return (await result.getAll()).map((row) => ({
    terminalId: String(row.terminalId),
    middleNodeIds: normalizeStringArray(row.middleNodeIds),
    relations: normalizeStringArray(row.relations),
    causalLevels: normalizeStringArray(row.causalLevels),
    weights: normalizeNumberArray(row.weights),
    descriptions: normalizeNullableStringArray(row.descriptions),
  }));
}

async function syncGraph(conn) {
  const { nodes, edges } = await readMergedGraph();
  await ensureKuzuSchema(conn);
  await clearKuzuGraph(conn);

  const insertNode = await conn.prepare(`
    CREATE (node:CausalNode {
      id: $id,
      label: $label,
      kind: $kind,
      dataLevel: $dataLevel,
      description: $description,
      sourceType: $sourceType
    });
  `);
  const insertEdge = await conn.prepare(`
    MATCH (source:CausalNode {id: $sourceId}), (target:CausalNode {id: $targetId})
    CREATE (source)-[:CAUSES {
      relation: $relation,
      causalLevel: $causalLevel,
      weight: $weight,
      description: $description,
      sourceType: $sourceType
    }]->(target);
  `);

  for (const node of nodes) {
    await conn.execute(insertNode, {
      id: node.id,
      label: node.label,
      kind: node.kind,
      dataLevel: node.dataLevel,
      description: node.description ?? null,
      sourceType: node.sourceType ?? "seed",
    });
  }

  for (const edge of edges) {
    await conn.execute(insertEdge, {
      sourceId: edge.source,
      targetId: edge.target,
      relation: edge.relation,
      causalLevel: edge.causalLevel,
      weight: edge.weight,
      description: edge.description ?? null,
      sourceType: edge.sourceType ?? "seed",
    });
  }

  return { dbPath: PERSONA_KUZU_DB_PATH, nodes: nodes.length, edges: edges.length };
}

async function main() {
  const command = process.argv[2] ?? "snapshot";
  const payload = readJsonArg();
  const { db, conn } = await openKuzuConnection();

  try {
    await ensureKuzuSchema(conn);

    if (command === "sync") {
      return await syncGraph(conn);
    }

    if (command === "snapshot") {
      return await readSnapshot(conn);
    }

    if (command === "node") {
      return await readNode(conn, payload?.nodeId ?? "");
    }

    if (command === "paths") {
      return await readPathRows(
        conn,
        payload?.startKey ?? "",
        payload?.direction === "upstream" ? "upstream" : "downstream",
        payload?.maxDepth ?? 3,
      );
    }

    if (command === "trace") {
      const direction = payload?.direction === "upstream" || payload?.direction === "downstream"
        ? payload.direction
        : "both";
      const startKey = payload?.startKey ?? "";
      const maxDepth = payload?.maxDepth ?? 3;

      const [graph, startNode, upstreamRows, downstreamRows] = await Promise.all([
        readSnapshot(conn),
        readNode(conn, startKey),
        direction === "downstream" ? Promise.resolve([]) : readPathRows(conn, startKey, "upstream", maxDepth),
        direction === "upstream" ? Promise.resolve([]) : readPathRows(conn, startKey, "downstream", maxDepth),
      ]);

      return { graph, startNode, upstreamRows, downstreamRows };
    }

    throw new Error(`Unknown kuzu command: ${command}`);
  } finally {
    await conn.close();
    await db.close();
  }
}

try {
  const result = await main();
  writeFileSync(1, JSON.stringify(result));
  process.exit(0);
} catch (error) {
  writeFileSync(2, `${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
