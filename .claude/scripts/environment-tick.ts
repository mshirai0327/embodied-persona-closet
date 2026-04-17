/**
 * environment-tick.ts — 環境センサーから STATUS.md を更新
 *
 * autonomous-action.sh から heartbeat のたびに呼ばれる。
 * 環境データを受動的に受け取り、内的状態（STATUS.md）を変化させる。
 *
 * 知覚源:
 *   - システム温度 (LHM HTTP API, port 8085) → 環境熱負荷 proxy → energy
 *   - カメラ明るさ (usb-webcam-mcp, capture-brightness.py) → mood
 *
 * CPU Core Max 温度 → energy:
 *   絶対温度ではなく、自分の通常温度のEMAからの乖離で判断する。
 *   baseline = EMA(previousBaseline, currentTemp)
 *   relativeDelta = baseline - currentTemp
 *   energyDelta = clamp(round(relativeDelta * 0.8), -8, +5)
 *
 *   例:
 *   - baseline 100°C / current 100°C → 変化なし
 *   - baseline 100°C / current 90°C  → 回復方向
 *   - baseline 100°C / current 110°C → 消耗方向
 *
 * カメラ平均輝度 (0-255) → mood:
 *   > 150 : +2  (明るい空間)
 *   50-150: 0   (変化なし)
 *   < 50  : -3  (暗い部屋)
 */

import { dirname } from "node:path";

import { $ } from "bun";

import { readEnvironmentDocument, setEnvironmentAuxValue, setEnvironmentObservation } from "./environment-store";
import { syncPersonaStructuredStore } from "./persona-data";
import { adjustStatusValue } from "./status-store";

const SCRIPT_DIR = import.meta.dir;
const LHM_URL = "http://localhost:8085/data.json";
const WEBCAM_MCP_DIR = `${SCRIPT_DIR}/../mcps/wifi-cam-mcp`;
const BRIGHTNESS_SCRIPT = `${SCRIPT_DIR}/capture-brightness-wifi.py`;
const ENVIRONMENT_STATE_PATH =
  process.env.WARDROBE_ENVIRONMENT_STATE_PATH?.trim()
  ?? `${SCRIPT_DIR}/../workingDirs/environment-state.json`;
const TEMPERATURE_EMA_ALPHA = 0.2;
const ENERGY_DELTA_SCALE = 0.8;
const ENERGY_DELTA_MIN = -8;
const ENERGY_DELTA_MAX = 5;

interface EnvironmentState {
  energyTemperatureBaseline?: number;
  lastObservedTemperature?: number;
  lastThermalLoad?: number;
  lastThermalBand?: string;
  lastTemperatureReason?: string;
  lastBrightness?: number;
  lastBrightnessNormalized?: number;
  lastBrightnessBand?: string;
  lastBrightnessAt?: string;
  sampleCount?: number;
  updatedAt?: string;
}

export interface EnergyTemperatureEvaluation {
  previousBaseline: number | null;
  nextBaseline: number;
  relativeDelta: number;
  energyDelta: number;
  reason: string;
}

export interface ThermalLoadProxy {
  normalizedValue: number;
  band: "cool" | "mild" | "stable" | "warm" | "hot";
  reason: string;
}

export interface BrightnessObservation {
  normalizedValue: number;
  band: "dark" | "dim" | "neutral" | "bright";
  reason: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function readEnvironmentState(): Promise<EnvironmentState> {
  const file = Bun.file(ENVIRONMENT_STATE_PATH);
  if (!(await file.exists())) return {};

  try {
    return (await file.json()) as EnvironmentState;
  } catch {
    return {};
  }
}

async function writeEnvironmentState(state: EnvironmentState): Promise<void> {
  await $`mkdir -p ${dirname(ENVIRONMENT_STATE_PATH)}`.quiet();
  await Bun.write(ENVIRONMENT_STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function computeTemperatureBaseline(
  previousBaseline: number | null | undefined,
  currentTemp: number,
  alpha = TEMPERATURE_EMA_ALPHA
): number {
  if (previousBaseline === null || previousBaseline === undefined || !Number.isFinite(previousBaseline)) {
    return currentTemp;
  }
  return previousBaseline * (1 - alpha) + currentTemp * alpha;
}

function computeThermalLoadScore(relativeDelta: number): number {
  return clamp(Math.round(50 - relativeDelta * 4), 0, 100);
}

export function evaluateThermalLoadProxy(
  currentTemp: number,
  evaluation: Pick<EnergyTemperatureEvaluation, "nextBaseline" | "relativeDelta">
): ThermalLoadProxy {
  const normalizedValue = computeThermalLoadScore(evaluation.relativeDelta);

  let band: ThermalLoadProxy["band"] = "stable";
  let stateText = "熱負荷はおおむね安定している。";
  if (normalizedValue >= 80) {
    band = "hot";
    stateText = "熱がかなりこもっている。";
  } else if (normalizedValue >= 60) {
    band = "warm";
    stateText = "少し熱がこもる。";
  } else if (normalizedValue <= 20) {
    band = "cool";
    stateText = "かなり涼しい。";
  } else if (normalizedValue <= 40) {
    band = "mild";
    stateText = "熱負荷は軽い。";
  }

  const deltaLabel = `${evaluation.relativeDelta >= 0 ? "+" : ""}${evaluation.relativeDelta.toFixed(1)}`;

  return {
    normalizedValue,
    band,
    reason:
      `環境熱負荷 proxy ${normalizedValue}/100（CPU ${currentTemp.toFixed(1)}°C / ` +
      `baseline ${evaluation.nextBaseline.toFixed(1)}°C / Δ${deltaLabel}°C）——${stateText}`,
  };
}

export function evaluateEnergyFromTemperature(
  currentTemp: number,
  previousBaseline?: number | null
): EnergyTemperatureEvaluation {
  const nextBaseline = computeTemperatureBaseline(previousBaseline, currentTemp);
  const relativeDelta = nextBaseline - currentTemp;
  const energyDelta = clamp(
    Math.round(relativeDelta * ENERGY_DELTA_SCALE),
    ENERGY_DELTA_MIN,
    ENERGY_DELTA_MAX
  );

  let stateText = "自分の通常温度に近い。大きな変化はない。";
  if (relativeDelta >= 8) {
    stateText = "いつもよりかなり涼しい。回復しやすい。";
  } else if (relativeDelta >= 3) {
    stateText = "いつもより少し涼しい。回復している。";
  } else if (relativeDelta <= -8) {
    stateText = "いつもよりかなり熱い。消耗が速い。";
  } else if (relativeDelta <= -3) {
    stateText = "いつもより少し熱い。じわじわ疲れる。";
  }

  const thermalLoad = evaluateThermalLoadProxy(currentTemp, { nextBaseline, relativeDelta });
  return {
    previousBaseline: previousBaseline ?? null,
    nextBaseline,
    relativeDelta,
    energyDelta,
    reason: `${thermalLoad.reason} ${stateText}`,
  };
}

export function describeBrightnessObservation(brightness: number): BrightnessObservation {
  const normalizedValue = clamp(Math.round((brightness / 255) * 100), 0, 100);

  let band: BrightnessObservation["band"] = "neutral";
  let stateText = "落ち着いた明るさ。";
  if (normalizedValue >= 75) {
    band = "bright";
    stateText = "かなり明るい空間。";
  } else if (normalizedValue <= 20) {
    band = "dark";
    stateText = "かなり暗い。";
  } else if (normalizedValue <= 40) {
    band = "dim";
    stateText = "少し暗め。";
  }

  return {
    normalizedValue,
    band,
    reason: `環境光 ${normalizedValue}/100（輝度${brightness.toFixed(0)}/255）——${stateText}`,
  };
}

// ── センサー取得 ──

async function getCpuCoreMax(): Promise<number | null> {
  try {
    const res = await fetch(LHM_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;

    const CPU_TEMP_NAMES = ["Core Max", "Core (Tctl/Tdie)", "CPU Package"];
    function findCoreMax(node: Record<string, unknown>): number | null {
      const name = String(node.Text ?? "");
      const val = String(node.Value ?? "");
      if (CPU_TEMP_NAMES.includes(name) && val.includes("°")) {
        return parseFloat(val.replace(/[^0-9.]/g, ""));
      }
      for (const child of (node.Children as Record<string, unknown>[]) ?? []) {
        const found = findCoreMax(child);
        if (found !== null) return found;
      }
      return null;
    }
    return findCoreMax(data);
  } catch {
    return null;
  }
}

// ── カメラ明るさ取得 ──

async function getRoomBrightness(): Promise<number | null> {
  try {
    const result = await $`uv run python ${BRIGHTNESS_SCRIPT}`
      .cwd(WEBCAM_MCP_DIR)
      .quiet();
    const val = parseFloat(result.stdout.toString().trim());
    return isNaN(val) ? null : val;
  } catch {
    return null;
  }
}

// ── STATUS.md のフィールドを更新 ──

async function updateStatus(field: "energy" | "mood", delta: number, reason: string) {
  const result = await adjustStatusValue(field, delta, { reason });
  if (!result || !result.changed) return;

  const actualDelta = result.nextValue - result.previousValue;
  console.log(
    `[environment-tick] ${field}: ${result.previousValue} → ${result.nextValue} (${actualDelta > 0 ? "+" : ""}${actualDelta})`
  );
}

// ── メイン ──

async function main() {
  const markdownState = await readEnvironmentDocument();
  const legacyState = await readEnvironmentState();
  const baselineFromMarkdown = markdownState?.aux.environment_thermal_baseline?.valueText;
  const sampleCountFromMarkdown = markdownState?.aux.environment_sample_count?.valueText;
  const previousBaseline = parseFloat(baselineFromMarkdown ?? "");
  const baseline = Number.isFinite(previousBaseline)
    ? previousBaseline
    : legacyState.energyTemperatureBaseline;
  const previousSampleCount = parseInt(sampleCountFromMarkdown ?? "", 10);
  const sampleCount = Number.isFinite(previousSampleCount)
    ? previousSampleCount
    : (legacyState.sampleCount ?? 0);

  let nextState: EnvironmentState = { ...legacyState };
  let stateDirty = false;

  // CPU 温度 → energy
  const coreMax = await getCpuCoreMax();
  if (coreMax !== null) {
    const evaluation = evaluateEnergyFromTemperature(coreMax, baseline);
    const thermalLoad = evaluateThermalLoadProxy(coreMax, evaluation);
    nextState = {
      ...nextState,
      energyTemperatureBaseline: evaluation.nextBaseline,
      lastObservedTemperature: coreMax,
      lastThermalLoad: thermalLoad.normalizedValue,
      lastThermalBand: thermalLoad.band,
      lastTemperatureReason: thermalLoad.reason,
      sampleCount: sampleCount + 1,
      updatedAt: new Date().toISOString(),
    };
    stateDirty = true;

    const deltaLabel = `${evaluation.relativeDelta >= 0 ? "+" : ""}${evaluation.relativeDelta.toFixed(1)}`;
    const energyLabel = `${evaluation.energyDelta >= 0 ? "+" : ""}${evaluation.energyDelta}`;
    console.log(
      `[environment-tick] Core Max: ${coreMax.toFixed(1)}°C (baseline ${evaluation.nextBaseline.toFixed(1)}°C / Δ${deltaLabel}°C / thermal ${thermalLoad.normalizedValue}/100 / energy ${energyLabel})`
    );

    await setEnvironmentObservation(
      "environment_thermal_load",
      `${formatDecimal(coreMax)} °C`,
      thermalLoad.normalizedValue,
      {
        source: "LHM/Core Max",
        reason: thermalLoad.reason,
        recordHistoryOnUnchanged: true,
      }
    );
    await setEnvironmentAuxValue(
      "environment_thermal_baseline",
      `${formatDecimal(evaluation.nextBaseline)} °C`,
      {
        note: "Core Max の EMA 基準値",
      }
    );
    await setEnvironmentAuxValue(
      "environment_sample_count",
      String(sampleCount + 1),
      {
        note: "baseline 算出に使ったサンプル数",
      }
    );

    if (evaluation.energyDelta !== 0) {
      await updateStatus("energy", evaluation.energyDelta, evaluation.reason);
    } else {
      console.log("[environment-tick] energy unchanged");
    }
  } else {
    console.log("[environment-tick] LHM unavailable, skipping temperature");
  }

  // カメラ明るさ → mood
  const brightness = await getRoomBrightness();
  if (brightness !== null) {
    const brightnessObservation = describeBrightnessObservation(brightness);
    console.log(`[environment-tick] Brightness: ${brightness.toFixed(1)}/255`);

    nextState = {
      ...nextState,
      lastBrightness: brightness,
      lastBrightnessNormalized: brightnessObservation.normalizedValue,
      lastBrightnessBand: brightnessObservation.band,
      lastBrightnessAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    stateDirty = true;

    await setEnvironmentObservation(
      "ambient_brightness",
      `${Math.round(brightness)} / 255`,
      brightnessObservation.normalizedValue,
      {
        source: "usb-webcam brightness",
        reason: brightnessObservation.reason,
        recordHistoryOnUnchanged: true,
      }
    );

    if (brightness > 150) {
      await updateStatus("mood", 2, brightnessObservation.reason);
    } else if (brightness < 50) {
      await updateStatus("mood", -3, brightnessObservation.reason);
    }
  } else {
    console.log("[environment-tick] Camera unavailable, skipping brightness");
  }

  if (stateDirty) {
    await writeEnvironmentState(nextState);
  }

  await syncPersonaStructuredStore();
}

if (import.meta.main) {
  await main();
}
