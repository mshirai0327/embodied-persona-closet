import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import type { CausalStatusProposal } from "./causal-runtime";
import { saveCausalRuntimeSnapshot } from "./causal-hint-store";
import { buildCausalHintLines, renderCausalHint } from "./causal-hint";

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

describe("causal-hint", () => {
  test("returns no hint when snapshot is absent", () => {
    expect(buildCausalHintLines(null)).toEqual([]);
    expect(renderCausalHint(null)).toBe("");
  });

  test("renders up to three lines from felt sense and action bias", async () => {
    tmpDirPath = await mkdtemp(join(tmpdir(), "persona-causal-hint-test-"));
    process.env.WARDROBE_CAUSAL_RUNTIME_PATH = join(tmpDirPath, "causal-runtime.json");

    const proposals: CausalStatusProposal[] = [
      {
        field: "energy",
        score: -0.73,
        delta: -6,
        reason: "環境熱負荷 proxy 92/100",
        topPathDescription: "環境熱負荷 proxy → energy",
        contributingSources: ["environment_thermal_load"],
      },
      {
        field: "health",
        score: -0.41,
        delta: -2,
        reason: "環境熱負荷 proxy 92/100",
        topPathDescription: "環境熱負荷 proxy → health",
        contributingSources: ["environment_thermal_load"],
      },
      {
        field: "mood",
        score: 0.18,
        delta: 1,
        reason: "環境光 58/100",
        topPathDescription: "環境光 → mood",
        contributingSources: ["ambient_brightness"],
      },
    ];

    const snapshot = await saveCausalRuntimeSnapshot(proposals, {
      now: new Date("2026-04-18T13:00:00.000Z"),
    });

    const lines = buildCausalHintLines(snapshot);
    const rendered = renderCausalHint(snapshot);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("はっきり重い。今は大きく動くより、軽いものから触れたい。");
    expect(lines[1]).toBe("少し消耗がたまっていて、無理はしないほうがよさそう。");
    expect(lines[2]).toBe("今は大きく広げず、まずは最小の一歩に留めたい。");
    expect(rendered.split("\n")).toHaveLength(3);
    expect(rendered).not.toContain("environment_thermal_load");
    expect(rendered).not.toContain("energy");
    expect(rendered).not.toContain("health");
    expect(rendered).not.toContain("drains");
    expect(rendered).not.toContain("pressures");
  });
});
