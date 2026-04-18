import {
  readKuzuTraceBundle,
  syncKuzuCausalGraph,
  type KuzuCausalPathRow,
  type KuzuTraceBundle,
} from "./causal-kuzu";
import type { StatusField } from "./status-store";

export type EnvironmentCausalSourceId =
  | "ambient_brightness"
  | "environment_thermal_load"
  | "ambient_temperature"
  | "ambient_humidity";
export type Phase1StatusField = Extract<StatusField, "mood" | "energy" | "health">;

export interface EnvironmentCausalSourceInput {
  sourceId: EnvironmentCausalSourceId;
  normalizedValue: number;
  reason: string;
}

export interface CausalContribution {
  sourceId: EnvironmentCausalSourceId;
  field: Phase1StatusField;
  score: number;
  observationReason: string;
  pathDescription: string;
}

export interface CausalStatusProposal {
  field: Phase1StatusField;
  score: number;
  delta: number;
  reason: string;
  topPathDescription: string;
  contributingSources: EnvironmentCausalSourceId[];
}

const TRACE_DEPTH = 3;
const DEPTH_DECAY = 0.85;
const STATUS_FIELDS: readonly Phase1StatusField[] = ["mood", "energy", "health"];
const POSITIVE_RELATIONS = new Set(["supports", "lifts", "raises"]);
const NEGATIVE_RELATIONS = new Set(["drains", "pressures", "lowers"]);
const AMBIGUOUS_RELATIONS = new Set(["modulates"]);
const PASS_THROUGH_RELATIONS = new Set(["proxies"]);

const TARGET_SCALES: Record<Phase1StatusField, number> = {
  mood: 5,
  energy: 9,
  health: 8,
};

const TARGET_LIMITS: Record<Phase1StatusField, { min: number; max: number }> = {
  mood: { min: -3, max: 2 },
  energy: { min: -6, max: 5 },
  health: { min: -4, max: 3 },
};

const TARGET_REASON_TEXT: Record<Phase1StatusField, { positive: string; negative: string }> = {
  mood: {
    positive: "気分を持ち上げる",
    negative: "気分を沈ませる",
  },
  energy: {
    positive: "活力を支える",
    negative: "活力を削る",
  },
  health: {
    positive: "健康感を支える",
    negative: "健康感を圧迫する",
  },
};

const WEATHER_INTERACTION_THRESHOLD = 0.2;
const WEATHER_INTERACTION_SCALE = 0.4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPhase1StatusField(value: string): value is Phase1StatusField {
  return (STATUS_FIELDS as readonly string[]).includes(value);
}

function formatSigned(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

export function normalizeCausalActivation(normalizedValue: number): number {
  return clamp((normalizedValue - 50) / 50, -1, 1);
}

export function getPhase1RelationSign(relation: string): number {
  if (POSITIVE_RELATIONS.has(relation)) return 1;
  if (NEGATIVE_RELATIONS.has(relation)) return -1;
  if (AMBIGUOUS_RELATIONS.has(relation)) return 0;
  if (PASS_THROUGH_RELATIONS.has(relation)) return 1;
  return 0;
}

export function computeCausalPathScore(
  activation: number,
  row: Pick<KuzuCausalPathRow, "relations" | "weights">,
  depthDecay = DEPTH_DECAY,
): number {
  if (activation === 0) return 0;

  let edgeProduct = 1;
  for (const [index, relation] of row.relations.entries()) {
    const sign = getPhase1RelationSign(relation);
    if (sign === 0) return 0;

    const weight = row.weights[index];
    edgeProduct *= weight * sign;
  }

  const depthFactor = depthDecay ** Math.max(0, row.weights.length - 1);
  return activation * edgeProduct * depthFactor;
}

function buildNodeLabelMap(bundle: KuzuTraceBundle): Map<string, string> {
  const labels = new Map<string, string>();
  for (const node of bundle.graph.nodes) {
    labels.set(node.id, node.label);
  }
  if (bundle.startNode) {
    labels.set(bundle.startNode.id, bundle.startNode.label);
  }
  return labels;
}

function describePath(bundle: KuzuTraceBundle, row: KuzuCausalPathRow): string {
  const labels = buildNodeLabelMap(bundle);
  const parts = [
    bundle.startNode?.label ?? bundle.startNode?.id ?? "(unknown)",
    ...row.middleNodeIds.map((nodeId) => labels.get(nodeId) ?? nodeId),
    labels.get(row.terminalId) ?? row.terminalId,
  ];
  return parts.join(" → ");
}

async function readTraceBundleWithBootstrap(startKey: EnvironmentCausalSourceId): Promise<KuzuTraceBundle> {
  const initial = await readKuzuTraceBundle(startKey, "downstream", TRACE_DEPTH);
  if (initial.startNode && initial.downstreamRows.length > 0) {
    return initial;
  }

  await syncKuzuCausalGraph();
  return readKuzuTraceBundle(startKey, "downstream", TRACE_DEPTH);
}

export function evaluateEnvironmentTraceBundle(
  input: EnvironmentCausalSourceInput,
  bundle: KuzuTraceBundle,
): CausalContribution[] {
  if (!bundle.startNode) {
    throw new Error(`Kuzu trace could not find source node: ${input.sourceId}`);
  }

  const activation = normalizeCausalActivation(input.normalizedValue);
  const contributions: CausalContribution[] = [];

  for (const row of bundle.downstreamRows) {
    if (!isPhase1StatusField(row.terminalId)) {
      continue;
    }

    const score = computeCausalPathScore(activation, row);
    if (score === 0) {
      continue;
    }

    contributions.push({
      sourceId: input.sourceId,
      field: row.terminalId,
      score,
      observationReason: input.reason,
      pathDescription: describePath(bundle, row),
    });
  }

  return contributions;
}

function pushContribution(
  contributions: Map<Phase1StatusField, CausalContribution[]>,
  contribution: CausalContribution,
): void {
  const list = contributions.get(contribution.field) ?? [];
  list.push(contribution);
  contributions.set(contribution.field, list);
}

function toDelta(field: Phase1StatusField, score: number): number {
  const limits = TARGET_LIMITS[field];
  return clamp(Math.round(score * TARGET_SCALES[field]), limits.min, limits.max);
}

function buildProposalReason(field: Phase1StatusField, top: CausalContribution, totalScore: number): string {
  const direction = totalScore >= 0 ? "positive" : "negative";
  const targetText = TARGET_REASON_TEXT[field][direction];
  return `${top.observationReason} Kuzu因果: ${top.pathDescription} が${targetText}方向に働いた（score ${formatSigned(totalScore)}）`;
}

function applyWeatherInteraction(
  inputs: EnvironmentCausalSourceInput[],
  contributions: Map<Phase1StatusField, CausalContribution[]>,
): void {
  const tempInput = inputs.find((input) => input.sourceId === "ambient_temperature");
  const humidityInput = inputs.find((input) => input.sourceId === "ambient_humidity");
  if (!tempInput || !humidityInput) {
    return;
  }

  const tempActivation = normalizeCausalActivation(tempInput.normalizedValue);
  const humidityActivation = normalizeCausalActivation(humidityInput.normalizedValue);
  if (tempActivation <= WEATHER_INTERACTION_THRESHOLD || humidityActivation <= WEATHER_INTERACTION_THRESHOLD) {
    return;
  }

  const interactionScore = -(tempActivation * humidityActivation * WEATHER_INTERACTION_SCALE);
  const observationReason = `${tempInput.reason} ${humidityInput.reason}`.trim();

  pushContribution(contributions, {
    sourceId: "ambient_humidity",
    field: "energy",
    score: interactionScore,
    observationReason,
    pathDescription: "気温 × 湿度 → energy",
  });
  pushContribution(contributions, {
    sourceId: "ambient_humidity",
    field: "health",
    score: interactionScore,
    observationReason,
    pathDescription: "気温 × 湿度 → health",
  });
}

export async function deriveEnvironmentCausalProposals(
  inputs: EnvironmentCausalSourceInput[],
): Promise<CausalStatusProposal[]> {
  const contributions = new Map<Phase1StatusField, CausalContribution[]>();

  for (const input of inputs) {
    const bundle = await readTraceBundleWithBootstrap(input.sourceId);
    const rows = evaluateEnvironmentTraceBundle(input, bundle);

    for (const row of rows) {
      pushContribution(contributions, row);
    }
  }

  applyWeatherInteraction(inputs, contributions);

  const proposals: CausalStatusProposal[] = [];
  for (const field of STATUS_FIELDS) {
    const fieldContributions = contributions.get(field);
    if (!fieldContributions || fieldContributions.length === 0) {
      continue;
    }

    const score = fieldContributions.reduce((sum, item) => sum + item.score, 0);
    const delta = toDelta(field, score);
    const top = fieldContributions.reduce((best, item) => (
      Math.abs(item.score) > Math.abs(best.score) ? item : best
    ));

    proposals.push({
      field,
      score,
      delta,
      reason: buildProposalReason(field, top, score),
      topPathDescription: top.pathDescription,
      contributingSources: Array.from(new Set(fieldContributions.map((item) => item.sourceId))),
    });
  }

  return proposals;
}
