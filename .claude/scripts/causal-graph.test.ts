import { describe, expect, test } from "bun:test";

import { traceCausalGraph } from "./causal-graph";

const SAMPLE_GRAPH = {
  nodes: [
    { id: "ambient_brightness", label: "環境光", kind: "environment", dataLevel: "Lv0", description: null },
    { id: "mood", label: "mood", kind: "emotion", dataLevel: "Lv3-2", description: null },
    { id: "social_openness", label: "social_openness", kind: "outcome", dataLevel: null, description: null },
    { id: "action_threshold", label: "action_threshold", kind: "action", dataLevel: null, description: null },
  ],
  edges: [
    { sourceId: "ambient_brightness", targetId: "mood", relation: "lifts", causalLevel: "Lv1", weight: 0.7, description: null },
    { sourceId: "mood", targetId: "social_openness", relation: "raises", causalLevel: "Lv2", weight: 0.8, description: null },
    { sourceId: "social_openness", targetId: "action_threshold", relation: "lowers", causalLevel: "Lv3", weight: 0.5, description: null },
  ],
  currentMetrics: [
    { key: "mood", label: "mood", level: "Lv3-2", valueText: "81", valueNumber: 81, unit: "score", reason: "bright room" },
  ],
};

describe("traceCausalGraph", () => {
  test("traces upstream and downstream chains with depth", () => {
    const result = traceCausalGraph(SAMPLE_GRAPH, "mood", { direction: "both", maxDepth: 3 });

    expect(result.startNode?.id).toBe("mood");
    expect(result.upstream).toHaveLength(1);
    expect(result.upstream[0]?.terminalId).toBe("ambient_brightness");
    expect(result.downstream).toHaveLength(2);
    expect(result.downstream[0]?.terminalId).toBe("social_openness");
    expect(result.downstream[1]?.terminalId).toBe("action_threshold");
    expect(result.edges.some((edge) => edge.direction === "upstream")).toBe(true);
    expect(result.edges.some((edge) => edge.direction === "downstream")).toBe(true);
  });

  test("guards against cycles while keeping the shortest chain", () => {
    const cyclicGraph = {
      ...SAMPLE_GRAPH,
      edges: [
        ...SAMPLE_GRAPH.edges,
        { sourceId: "action_threshold", targetId: "mood", relation: "feeds_back", causalLevel: "Lv3", weight: 0.4, description: null },
      ],
    };

    const result = traceCausalGraph(cyclicGraph, "mood", { direction: "downstream", maxDepth: 4 });

    expect(result.downstream.find((chain) => chain.terminalId === "action_threshold")?.depth).toBe(2);
    expect(result.downstream.some((chain) => chain.nodeIds.filter((id) => id === "mood").length > 1)).toBe(false);
  });
});
