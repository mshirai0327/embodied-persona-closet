import { describe, expect, test } from "bun:test";

import {
  mergeCausalGraphs,
  parseCausalSeedGraph,
  parseLearnedSeedGraph,
} from "./causal-graph-loader";

describe("causal-graph-loader", () => {
  test("merges directed learned edges into seed graph", () => {
    const graph = mergeCausalGraphs({
      seed: parseCausalSeedGraph(JSON.stringify({
        nodes: [
          { id: "ambient_brightness", label: "環境光", kind: "environment", dataLevel: "Lv0" },
          { id: "mood", label: "mood", kind: "emotion", dataLevel: "Lv3-2" },
          { id: "energy", label: "energy", kind: "emotion", dataLevel: "Lv3-2" },
        ],
        edges: [
          {
            source: "ambient_brightness",
            target: "mood",
            relation: "lifts",
            causalLevel: "Lv1",
            weight: 0.76,
          },
        ],
      })),
      learned: parseLearnedSeedGraph(JSON.stringify({
        learnedEdges: [
          {
            id: "learned_mood_energy_001",
            pair: ["mood", "energy"],
            source: "mood",
            target: "energy",
            direction: "mood->energy",
            relation: "lifts",
            causalLevel: "Lv2",
            weight: 0.3,
            status: "observing",
          },
        ],
      })),
    });

    expect(graph.nodes.map((node) => node.id).sort()).toEqual([
      "ambient_brightness",
      "energy",
      "mood",
    ]);
    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: "ambient_brightness",
        target: "mood",
        sourceType: "seed",
      }),
      expect.objectContaining({
        source: "mood",
        target: "energy",
        sourceType: "learned",
      }),
    ]);
  });

  test("skips ambiguous, rejected, and seed-duplicate learned edges", () => {
    const graph = mergeCausalGraphs({
      seed: {
        nodes: [
          { id: "mood", label: "mood", kind: "emotion", dataLevel: "Lv3-2" },
          { id: "energy", label: "energy", kind: "emotion", dataLevel: "Lv3-2" },
          { id: "health", label: "health", kind: "emotion", dataLevel: "Lv3-2" },
        ],
        edges: [
          {
            source: "energy",
            target: "health",
            relation: "supports",
            causalLevel: "Lv1",
            weight: 0.8,
          },
        ],
      },
      learned: {
        learnedEdges: [
          {
            id: "learned_energy_health_001",
            source: "energy",
            target: "health",
            direction: "energy->health",
            relation: "lifts",
            status: "observing",
          },
          {
            id: "learned_mood_health_001",
            pair: ["mood", "health"],
            source: null,
            target: null,
            direction: "ambiguous",
            relation: "modulates",
            status: "observing",
          },
          {
            id: "learned_health_mood_001",
            source: "health",
            target: "mood",
            direction: "health->mood",
            relation: "lifts",
            status: "rejected",
          },
        ],
      },
    });

    expect(graph.edges).toEqual([
      expect.objectContaining({
        source: "energy",
        target: "health",
        relation: "supports",
        sourceType: "seed",
      }),
    ]);
  });

  test("creates fallback nodes for learned-only endpoints", () => {
    const graph = mergeCausalGraphs({
      seed: { nodes: [], edges: [] },
      learned: {
        learnedEdges: [
          {
            id: "learned_trust_mizuho_satiation_001",
            source: "trust_mizuho",
            target: "satiation",
            direction: "trust_mizuho->satiation",
            relation: "lifts",
            status: "confirmed",
          },
        ],
      },
    });

    expect(graph.nodes).toEqual([
      expect.objectContaining({ id: "satiation", kind: "emotion", sourceType: "learned" }),
      expect.objectContaining({ id: "trust_mizuho", kind: "emotion", sourceType: "learned" }),
    ]);
    expect(graph.edges[0]).toEqual(expect.objectContaining({
      source: "trust_mizuho",
      target: "satiation",
      causalLevel: "Lv2",
      weight: 0.3,
      sourceType: "learned",
    }));
  });
});
