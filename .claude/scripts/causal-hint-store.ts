import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type {
  CausalStatusProposal,
  EnvironmentCausalSourceId,
  Phase1StatusField,
} from "./causal-runtime";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_CAUSAL_RUNTIME_PATH = resolve(PROJECT_ROOT, ".claude/workingDirs/causal-runtime.json");

export const FELT_SENSE_TARGETS = ["mood", "energy", "health"] as const satisfies readonly Phase1StatusField[];
export const FELT_SENSE_DIRECTIONS = ["positive", "negative"] as const;
export const FELT_SENSE_INTENSITIES = ["weak", "medium", "strong"] as const;

export type FeltSenseTarget = Phase1StatusField;
export type FeltSenseDirection = typeof FELT_SENSE_DIRECTIONS[number];
export type FeltSenseIntensity = typeof FELT_SENSE_INTENSITIES[number];

export interface FeltSenseEntry {
  target: FeltSenseTarget;
  direction: FeltSenseDirection;
  intensity: FeltSenseIntensity;
  text: string;
  score: number;
  delta: number;
}

export interface CausalRuntimeSnapshot {
  updatedAt: string;
  activeSources: EnvironmentCausalSourceId[];
  proposals: CausalStatusProposal[];
  feltSense: FeltSenseEntry[];
}

export const FELT_SENSE_TEMPLATES: Record<
  FeltSenseTarget,
  Record<FeltSenseDirection, Record<FeltSenseIntensity, string>>
> = {
  mood: {
    positive: {
      weak: "周りの明るさに押されて、気分が少し軽い。",
      medium: "気分が少し持ち上がっていて、物事を前向きに見やすい。",
      strong: "気持ちが軽い。よく動ける感じがある。",
    },
    negative: {
      weak: "気分に少し陰りがあって、反応は控えめになりやすい。",
      medium: "気分がやや沈みがちで、外へ向く勢いは出にくい。",
      strong: "気持ちが重く沈んでいて、今は内側に引きこもりやすい。",
    },
  },
  energy: {
    positive: {
      weak: "少し軽さが戻っていて、手を伸ばすハードルが下がっている。",
      medium: "身体の重みが抜けてきて、普段より動きやすい。",
      strong: "かなり軽い。今は自然に動き出せる感じがある。",
    },
    negative: {
      weak: "少し重みがある。普段より動きが鈍い。",
      medium: "熱がこもる感じが続いていて、動きは鈍くなりやすい。",
      strong: "はっきり重い。今は大きく動くより、軽いものから触れたい。",
    },
  },
  health: {
    positive: {
      weak: "無理をしなくても保てる感じがあって、落ち着いていられる。",
      medium: "少し持ち直していて、無理をしなければ安定しやすい。",
      strong: "かなり保たれている感じがあって、崩れずにいられそう。",
    },
    negative: {
      weak: "少し消耗があり、今は無理を重ねたくない。",
      medium: "少し消耗がたまっていて、無理はしないほうがよさそう。",
      strong: "消耗がはっきり残っていて、まずは負荷を下げたい感じがある。",
    },
  },
};

function byAbsoluteScore(left: { score: number }, right: { score: number }): number {
  return Math.abs(right.score) - Math.abs(left.score);
}

export function resolveCausalRuntimePath(explicitPath?: string): string {
  return explicitPath ?? process.env.WARDROBE_CAUSAL_RUNTIME_PATH?.trim() ?? DEFAULT_CAUSAL_RUNTIME_PATH;
}

export function classifyFeltSenseDirection(score: number): FeltSenseDirection {
  return score >= 0 ? "positive" : "negative";
}

export function classifyFeltSenseIntensity(score: number): FeltSenseIntensity {
  const magnitude = Math.abs(score);
  if (magnitude >= 0.55) return "strong";
  if (magnitude >= 0.25) return "medium";
  return "weak";
}

export function buildFeltSenseEntry(proposal: CausalStatusProposal): FeltSenseEntry | null {
  if (proposal.score === 0 || proposal.delta === 0) {
    return null;
  }

  const target = proposal.field;
  const direction = classifyFeltSenseDirection(proposal.score);
  const intensity = classifyFeltSenseIntensity(proposal.score);

  return {
    target,
    direction,
    intensity,
    text: FELT_SENSE_TEMPLATES[target][direction][intensity],
    score: proposal.score,
    delta: proposal.delta,
  };
}

export function buildCausalRuntimeSnapshot(
  proposals: CausalStatusProposal[],
  now = new Date(),
): CausalRuntimeSnapshot {
  const activeSources = Array.from(
    new Set(proposals.flatMap((proposal) => proposal.contributingSources))
  ).sort() as EnvironmentCausalSourceId[];

  const feltSense = proposals
    .map((proposal) => buildFeltSenseEntry(proposal))
    .filter((entry): entry is FeltSenseEntry => entry !== null)
    .sort(byAbsoluteScore);

  return {
    updatedAt: now.toISOString(),
    activeSources,
    proposals,
    feltSense,
  };
}

export async function saveCausalRuntimeSnapshot(
  proposals: CausalStatusProposal[],
  options: {
    now?: Date;
    runtimePath?: string;
  } = {},
): Promise<CausalRuntimeSnapshot> {
  const runtimePath = resolveCausalRuntimePath(options.runtimePath);
  const snapshot = buildCausalRuntimeSnapshot(proposals, options.now);

  mkdirSync(dirname(runtimePath), { recursive: true });
  await Bun.write(runtimePath, JSON.stringify(snapshot, null, 2) + "\n");

  return snapshot;
}

export async function readCausalRuntimeSnapshot(
  runtimePath?: string,
): Promise<CausalRuntimeSnapshot | null> {
  const resolvedPath = resolveCausalRuntimePath(runtimePath);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) return null;

  try {
    return await file.json() as CausalRuntimeSnapshot;
  } catch {
    return null;
  }
}
