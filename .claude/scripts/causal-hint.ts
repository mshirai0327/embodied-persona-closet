#!/usr/bin/env bun

import {
  readCausalRuntimeSnapshot,
  type CausalRuntimeSnapshot,
  type FeltSenseEntry,
} from "./causal-hint-store";

const MAX_HINT_LINES = 3;
const MAX_FELT_SENSE_LINES = 2;

const ACTION_BIAS_TEMPLATES = {
  mood: {
    positive: {
      weak: "今は軽く外へ向いてよさそう。",
      medium: "今は前向きな整理や軽い探索に向きやすい。",
      strong: "今は素直に動いてみると、流れに乗りやすい。",
    },
    negative: {
      weak: "今は刺激を増やしすぎず、落ち着けるものから触れたい。",
      medium: "今は外へ広げるより、静かな整理から入りたい。",
      strong: "今は無理に外へ向かわず、内側を守る動きが合っている。",
    },
  },
  energy: {
    positive: {
      weak: "今は小さく手を伸ばしやすい。",
      medium: "今は軽い探索や整理を進めやすい。",
      strong: "今は少し大きめでも、自然に動き出しやすい。",
    },
    negative: {
      weak: "今は軽いものから触れたい。",
      medium: "今は負荷を絞って、軽いものから進めたい。",
      strong: "今は大きく広げず、まずは最小の一歩に留めたい。",
    },
  },
  health: {
    positive: {
      weak: "今は無理を重ねず、このまま落ち着いて進めたい。",
      medium: "今は保ちながら、静かに進めるやり方が合っている。",
      strong: "今は崩しにくいので、無理のない範囲で進めやすい。",
    },
    negative: {
      weak: "今は余白を残して、負荷を重ねすぎたくない。",
      medium: "今は無理を足さず、保つことを優先したい。",
      strong: "今はまず負荷を下げて、守る動きを先にしたい。",
    },
  },
} as const;

function sortByAbsoluteScore(entries: FeltSenseEntry[]): FeltSenseEntry[] {
  return [...entries].sort((left, right) => Math.abs(right.score) - Math.abs(left.score));
}

export function selectFeltSenseEntries(
  snapshot: CausalRuntimeSnapshot,
  maxEntries = MAX_FELT_SENSE_LINES,
): FeltSenseEntry[] {
  const seen = new Set<string>();
  const picked: FeltSenseEntry[] = [];

  for (const entry of sortByAbsoluteScore(snapshot.feltSense)) {
    if (seen.has(entry.text)) continue;
    seen.add(entry.text);
    picked.push(entry);
    if (picked.length >= maxEntries) break;
  }

  return picked;
}

export function buildActionBias(entry: FeltSenseEntry): string {
  return ACTION_BIAS_TEMPLATES[entry.target][entry.direction][entry.intensity];
}

export function buildCausalHintLines(
  snapshot: CausalRuntimeSnapshot | null,
  maxLines = MAX_HINT_LINES,
): string[] {
  if (!snapshot || snapshot.feltSense.length === 0 || maxLines <= 0) {
    return [];
  }

  const lines = selectFeltSenseEntries(snapshot, Math.min(MAX_FELT_SENSE_LINES, maxLines))
    .map((entry) => entry.text);

  const strongest = selectFeltSenseEntries(snapshot, 1)[0];
  if (strongest && lines.length < maxLines) {
    const actionBias = buildActionBias(strongest);
    if (actionBias && !lines.includes(actionBias)) {
      lines.push(actionBias);
    }
  }

  return lines.slice(0, maxLines);
}

export function renderCausalHint(
  snapshot: CausalRuntimeSnapshot | null,
  maxLines = MAX_HINT_LINES,
): string {
  return buildCausalHintLines(snapshot, maxLines).join("\n");
}

async function main() {
  const snapshot = await readCausalRuntimeSnapshot();
  if (!snapshot) return;

  const text = renderCausalHint(snapshot);
  if (!text) return;

  process.stdout.write(text);
}

if (import.meta.main) {
  await main();
}
