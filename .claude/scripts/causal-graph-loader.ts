import { resolve } from "node:path";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_CAUSAL_SEED_PATH = resolve(PROJECT_ROOT, ".claude/persona/causal-seeds.json");
const DEFAULT_LEARNED_SEEDS_PATH = resolve(PROJECT_ROOT, ".claude/persona/learned-seeds.json");

export type CausalGraphSourceType = "seed" | "learned";
export type CausalGraphNodeKind =
  | "environment"
  | "sensor"
  | "vital"
  | "emotion"
  | "latent"
  | "action"
  | "outcome";
export type CausalGraphLevel = "Lv1" | "Lv2" | "Lv3";
export type CausalGraphDataLevel = "Lv0" | "Lv1-1" | "Lv1-2" | "Lv2" | "Lv3-1" | "Lv3-2";

export interface CausalSeedNode {
  id: string;
  label: string;
  kind: CausalGraphNodeKind;
  dataLevel: CausalGraphDataLevel | null;
  description?: string | null;
}

export interface CausalSeedEdge {
  source: string;
  target: string;
  relation: string;
  causalLevel: CausalGraphLevel;
  weight: number;
  description?: string | null;
}

export interface LearnedSeedEdge {
  id: string;
  pair?: string[];
  source?: string | null;
  target?: string | null;
  direction?: string;
  relation?: string;
  causalLevel?: CausalGraphLevel;
  weight?: number;
  status?: string;
  description?: string | null;
}

export interface CausalSeedGraph {
  nodes: CausalSeedNode[];
  edges: CausalSeedEdge[];
}

export interface LearnedSeedGraph {
  learnedEdges: LearnedSeedEdge[];
}

export interface MergedCausalNode extends CausalSeedNode {
  sourceType: CausalGraphSourceType;
}

export interface MergedCausalEdge extends CausalSeedEdge {
  sourceType: CausalGraphSourceType;
}

export interface MergedCausalGraph {
  nodes: MergedCausalNode[];
  edges: MergedCausalEdge[];
}

const DEFAULT_LEARNED_NODE_META: Record<string, Omit<CausalSeedNode, "id">> = {
  mood: { label: "mood", kind: "emotion", dataLevel: "Lv3-2", description: null },
  energy: { label: "energy", kind: "emotion", dataLevel: "Lv3-2", description: null },
  health: { label: "health", kind: "emotion", dataLevel: "Lv3-2", description: null },
  trust_mizuho: { label: "trust_mizuho", kind: "emotion", dataLevel: "Lv3-2", description: null },
  satiation: { label: "satiation", kind: "emotion", dataLevel: "Lv3-2", description: null },
};

function parseJsonOrNull<T>(text: string | null | undefined): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function cleanId(value: string | null | undefined): string | null {
  const id = String(value ?? "").trim();
  return id ? id : null;
}

function normalizeWeight(value: unknown): number {
  const weight = Number(value);
  return Number.isFinite(weight) ? weight : 0.3;
}

function normalizeLearnedStatus(value: string | null | undefined): string {
  return String(value ?? "observing").trim() || "observing";
}

function fallbackLearnedNode(id: string): MergedCausalNode {
  const meta = DEFAULT_LEARNED_NODE_META[id] ?? {
    label: id,
    kind: "latent" as const,
    dataLevel: null,
    description: null,
  };

  return {
    id,
    ...meta,
    sourceType: "learned",
  };
}

function sourceTargetKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function edgeIdentityKey(edge: Pick<CausalSeedEdge, "source" | "target" | "relation">): string {
  return `${edge.source}->${edge.target}:${edge.relation}`;
}

export function parseCausalSeedGraph(text: string | null | undefined): CausalSeedGraph {
  const parsed = parseJsonOrNull<Partial<CausalSeedGraph>>(text);
  return {
    nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
    edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
  };
}

export function parseLearnedSeedGraph(text: string | null | undefined): LearnedSeedGraph {
  const parsed = parseJsonOrNull<Partial<LearnedSeedGraph>>(text);
  return {
    learnedEdges: Array.isArray(parsed?.learnedEdges) ? parsed.learnedEdges : [],
  };
}

export function mergeCausalGraphs(options: {
  seed: CausalSeedGraph;
  learned?: LearnedSeedGraph;
  includeStatuses?: readonly string[];
  includeAmbiguous?: boolean;
}): MergedCausalGraph {
  const includeStatuses = new Set(options.includeStatuses ?? ["observing", "confirmed"]);
  const nodes = new Map<string, MergedCausalNode>();
  const edges = new Map<string, MergedCausalEdge>();
  const seedPairs = new Set<string>();
  const learnedPairs = new Set<string>();

  for (const node of options.seed.nodes) {
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

  for (const edge of options.seed.edges) {
    const source = cleanId(edge.source);
    const target = cleanId(edge.target);
    if (!source || !target) continue;

    const normalizedEdge: MergedCausalEdge = {
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

  for (const edge of options.learned?.learnedEdges ?? []) {
    const status = normalizeLearnedStatus(edge.status);
    if (!includeStatuses.has(status)) continue;
    if (!options.includeAmbiguous && edge.direction === "ambiguous") continue;

    const source = cleanId(edge.source);
    const target = cleanId(edge.target);
    if (!source || !target) continue;

    const pairKey = sourceTargetKey(source, target);
    if (seedPairs.has(pairKey) || learnedPairs.has(pairKey)) continue;

    if (!nodes.has(source)) nodes.set(source, fallbackLearnedNode(source));
    if (!nodes.has(target)) nodes.set(target, fallbackLearnedNode(target));

    const normalizedEdge: MergedCausalEdge = {
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

export async function readTextOrNull(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return file.exists().then(async (exists) => (exists ? file.text() : null));
}

export function resolveCausalSeedPath(explicitPath?: string): string {
  return explicitPath ?? process.env.WARDROBE_CAUSAL_SEED_PATH?.trim() ?? DEFAULT_CAUSAL_SEED_PATH;
}

export function resolveLearnedSeedsPath(explicitPath?: string): string {
  return explicitPath ?? process.env.WARDROBE_LEARNED_SEEDS_PATH?.trim() ?? DEFAULT_LEARNED_SEEDS_PATH;
}

export async function readMergedCausalGraph(options: {
  causalSeedPath?: string;
  learnedSeedsPath?: string;
  includeStatuses?: readonly string[];
  includeAmbiguous?: boolean;
} = {}): Promise<MergedCausalGraph> {
  const [seedText, learnedText] = await Promise.all([
    readTextOrNull(resolveCausalSeedPath(options.causalSeedPath)),
    readTextOrNull(resolveLearnedSeedsPath(options.learnedSeedsPath)),
  ]);

  return mergeCausalGraphs({
    seed: parseCausalSeedGraph(seedText),
    learned: parseLearnedSeedGraph(learnedText),
    includeStatuses: options.includeStatuses,
    includeAmbiguous: options.includeAmbiguous,
  });
}
