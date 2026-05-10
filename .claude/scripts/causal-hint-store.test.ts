import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import type { CausalStatusProposal } from "./causal-runtime";
import {
  FELT_SENSE_DIRECTIONS,
  FELT_SENSE_INTENSITIES,
  FELT_SENSE_TARGETS,
  FELT_SENSE_TEMPLATES,
  readCausalRuntimeSnapshot,
  saveCausalRuntimeSnapshot,
} from "./causal-hint-store";

const ORIGINAL_CAUSAL_RUNTIME_PATH = process.env.WARDROBE_CAUSAL_RUNTIME_PATH;

let tmpDirPath: string | null = null;

afterEach(async () => {
  if (ORIGINAL_CAUSAL_RUNTIME_PATH == null) {
    delete process.env.WARDROBE_CAUSAL_RUNTIME_PATH;
  } else {
    process.env.WARDROBE_CAUSAL_RUNTIME_PATH = ORIGINAL_CAUSAL_RUNTIME_PATH;
  }

  if (tmpDirPath) {
    await rm(tmpDirPath, { recursive: true, force: true });
    tmpDirPath = null;
  }
});

describe("causal-hint-store", () => {
  test("defines every feltSense template slot", () => {
    const slots = FELT_SENSE_TARGETS.flatMap((target) =>
      FELT_SENSE_DIRECTIONS.flatMap((direction) =>
        FELT_SENSE_INTENSITIES.map((intensity) => ({
          target,
          direction,
          intensity,
          text: FELT_SENSE_TEMPLATES[target][direction][intensity],
        }))
      )
    );

    expect(slots).toHaveLength(18);
    for (const slot of slots) {
      expect(slot.text.length).toBeGreaterThan(0);
    }
  });

  test("round-trips a saved causal runtime snapshot", async () => {
    tmpDirPath = await mkdtemp(join(tmpdir(), "persona-causal-hint-store-test-"));
    process.env.WARDROBE_CAUSAL_RUNTIME_PATH = join(tmpDirPath, "causal-runtime.json");

    const proposals: CausalStatusProposal[] = [
      {
        field: "mood",
        score: 0.61,
        delta: 2,
        reason: "環境光 81/100 Kuzu因果: 環境光 → mood が気分を持ち上げる方向に働いた（score +0.61）",
        topPathDescription: "環境光 → mood",
        contributingSources: ["ambient_brightness"],
      },
      {
        field: "energy",
        score: -0.48,
        delta: -4,
        reason: "環境熱負荷 proxy 85/100 Kuzu因果: 環境熱負荷 proxy → energy が活力を削る方向に働いた（score -0.48）",
        topPathDescription: "環境熱負荷 proxy → energy",
        contributingSources: ["environment_thermal_load"],
      },
      {
        field: "health",
        score: 0,
        delta: 0,
        reason: "score 0",
        topPathDescription: "環境熱負荷 proxy → health",
        contributingSources: ["environment_thermal_load"],
      },
    ];

    const saved = await saveCausalRuntimeSnapshot(proposals, {
      now: new Date("2026-04-18T12:00:00.000Z"),
    });
    const loaded = await readCausalRuntimeSnapshot();

    expect(saved.updatedAt).toBe("2026-04-18T12:00:00.000Z");
    expect(saved.activeSources).toEqual(["ambient_brightness", "environment_thermal_load"]);
    expect(saved.feltSense).toHaveLength(2);
    expect(saved.feltSense[0]).toEqual({
      target: "mood",
      direction: "positive",
      intensity: "strong",
      text: "気持ちが軽い。よく動ける感じがある。",
      score: 0.61,
      delta: 2,
    });
    expect(saved.feltSense[1]).toEqual({
      target: "energy",
      direction: "negative",
      intensity: "medium",
      text: "熱がこもる感じが続いていて、動きは鈍くなりやすい。",
      score: -0.48,
      delta: -4,
    });
    expect(loaded).toEqual(saved);
  });
});
