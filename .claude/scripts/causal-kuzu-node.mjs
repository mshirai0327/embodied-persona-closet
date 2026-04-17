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
const PERSONA_KUZU_DB_PATH =
  process.env.WARDROBE_PERSONA_KUZU_DB_PATH?.trim()
  ?? resolve(PROJECT_ROOT, ".claude/workingDirs/persona-causal.kuzu");

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

async function readSeedGraph() {
  if (!existsSync(DEFAULT_CAUSAL_SEED_PATH)) {
    return { nodes: [], edges: [] };
  }

  const parsed = JSON.parse(await readFile(DEFAULT_CAUSAL_SEED_PATH, "utf8"));
  return {
    nodes: parsed.nodes ?? [],
    edges: parsed.edges ?? [],
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
      node.description AS description
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
      edge.description AS description
    ORDER BY edge.causalLevel, source.id, target.id;
  `);

  return {
    nodes: (await nodeResult.getAll()).map((row) => ({
      id: String(row.id),
      label: String(row.label),
      kind: String(row.kind),
      dataLevel: row.dataLevel == null ? null : String(row.dataLevel),
      description: row.description == null ? null : String(row.description),
    })),
    edges: (await edgeResult.getAll()).map((row) => ({
      sourceId: String(row.sourceId),
      targetId: String(row.targetId),
      relation: String(row.relation),
      causalLevel: String(row.causalLevel),
      weight: Number(row.weight),
      description: row.description == null ? null : String(row.description),
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
      node.description AS description
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
  const { nodes, edges } = await readSeedGraph();
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
      sourceType: "seed",
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
      sourceType: "seed",
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
