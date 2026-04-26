/**
 * environment-tick.ts — 環境センサーから STATUS.md を更新
 *
 * autonomous-action.sh から heartbeat のたびに呼ばれる。
 * 環境データを受動的に受け取り、内的状態（STATUS.md）を変化させる。
 *
 * 知覚源:
 *   - システム温度 (LHM HTTP API, port 8085) → 環境熱負荷 proxy → energy
 *   - wifi-cam 輝度 (RTSP snapshot) → ambient_brightness → mood
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
 *   ナイトビジョンを切った実輝度で「夜 / 朝」を区別する。
 *   ROI の slow EMA baseline は設置位置差と「いつもより明るい」を見る補助に留め、
 *   暗さそのものを baseline に吸収しない。
 */

import { dirname } from "node:path";

import { $ } from "bun";

import { saveCausalRuntimeSnapshot } from "./causal-hint-store";
import {
  deriveEnvironmentCausalProposals,
  type EnvironmentCausalSourceInput,
} from "./causal-runtime";
import { readEnvironmentDocument, setEnvironmentAuxValue, setEnvironmentObservation } from "./environment-store";
import { fetchJmaWeatherSnapshot, type JmaWeatherSnapshot } from "./jma-weather";
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
const BRIGHTNESS_EMA_ALPHA = 0.1;
const ENERGY_DELTA_SCALE = 0.8;
const ENERGY_DELTA_MIN = -8;
const ENERGY_DELTA_MAX = 5;
const BRIGHTNESS_NORMALIZATION_SPAN = 60;
const DEFAULT_BRIGHTNESS_ROI = Object.freeze({
  x: 0.2,
  y: 0.2,
  width: 0.6,
  height: 0.6,
});

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
  brightnessBaseline?: number;
  brightnessSampleCount?: number;
  brightnessRoi?: string;
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
  relativeNormalizedValue: number;
  band: "dark" | "dim" | "neutral" | "bright";
  baseline: number;
  relativeDelta: number;
  roiSpec: string;
  reason: string;
}

export interface BrightnessRoi {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StatusFallbackUpdate {
  field: "energy" | "mood" | "health";
  delta: number;
  reason: string;
}

export interface JmaWeatherObservationBundle {
  weather: JmaWeatherSnapshot | null;
  causalInputs: EnvironmentCausalSourceInput[];
  errorMessage: string | null;
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

export function computeBrightnessBaseline(
  previousBaseline: number | null | undefined,
  currentBrightness: number,
  alpha = BRIGHTNESS_EMA_ALPHA,
): number {
  if (previousBaseline === null || previousBaseline === undefined || !Number.isFinite(previousBaseline)) {
    return currentBrightness;
  }
  return previousBaseline * (1 - alpha) + currentBrightness * alpha;
}

export function parseBrightnessRoiSpec(raw: string | null | undefined): BrightnessRoi | null {
  if (!raw) return null;

  const parts = raw.split(",").map((part) => Number.parseFloat(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  let [x, y, width, height] = parts;
  if ([x, y, width, height].some((part) => part > 1)) {
    x /= 100;
    y /= 100;
    width /= 100;
    height /= 100;
  }

  if (width <= 0 || height <= 0) return null;
  if (x < 0 || y < 0 || x + width > 1 || y + height > 1) return null;

  return { x, y, width, height };
}

export function formatBrightnessRoiSpec(roi: BrightnessRoi): string {
  return [roi.x, roi.y, roi.width, roi.height].map((value) => value.toFixed(2)).join(",");
}

function resolveBrightnessRoi(raw: string | null | undefined): BrightnessRoi {
  return parseBrightnessRoiSpec(raw) ?? DEFAULT_BRIGHTNESS_ROI;
}

function normalizeBrightnessAgainstBaseline(currentBrightness: number, baseline: number): number {
  const centered = 50 + ((currentBrightness - baseline) / BRIGHTNESS_NORMALIZATION_SPAN) * 50;
  return clamp(Math.round(centered), 0, 100);
}

function normalizeAbsoluteBrightness(currentBrightness: number): number {
  return clamp(Math.round((currentBrightness / 255) * 100), 0, 100);
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

export function describeBrightnessObservation(
  brightness: number,
  options: {
    baseline?: number | null;
    roiSpec?: string | null;
  } = {},
): BrightnessObservation {
  const baseline = Number.isFinite(options.baseline ?? Number.NaN)
    ? Number(options.baseline)
    : brightness;
  const normalizedValue = normalizeAbsoluteBrightness(brightness);
  const relativeNormalizedValue = normalizeBrightnessAgainstBaseline(brightness, baseline);
  const relativeDelta = brightness - baseline;
  const deltaLabel = `${relativeDelta >= 0 ? "+" : ""}${relativeDelta.toFixed(1)}`;
  const roiSpec = options.roiSpec?.trim() || formatBrightnessRoiSpec(DEFAULT_BRIGHTNESS_ROI);

  let band: BrightnessObservation["band"] = "neutral";
  let stateText = "夜朝判定では中間的な明るさ。";
  if (normalizedValue >= 70) {
    band = "bright";
    stateText = "実輝度としてかなり明るい。";
  } else if (normalizedValue <= 20) {
    band = "dark";
    stateText = "実輝度としてかなり暗い。";
  } else if (normalizedValue <= 35) {
    band = "dim";
    stateText = "実輝度として少し暗め。";
  } else if (relativeNormalizedValue >= 75) {
    band = "bright";
    stateText = "実輝度は中間だが、baseline よりかなり明るい。";
  }

  return {
    normalizedValue,
    relativeNormalizedValue,
    band,
    baseline,
    relativeDelta,
    roiSpec,
    reason:
      `環境光 ${normalizedValue}/100（ROI輝度${brightness.toFixed(0)}/255 / ` +
      `baseline相対 ${relativeNormalizedValue}/100 / baseline ${baseline.toFixed(1)} / ` +
      `Δ${deltaLabel} / ROI ${roiSpec}）——${stateText}`,
  };
}

export function evaluateMoodFromBrightness(
  brightness: number,
  observation: BrightnessObservation = describeBrightnessObservation(brightness),
): { moodDelta: number; reason: string } {
  if (observation.band === "bright") {
    return { moodDelta: 2, reason: observation.reason };
  }

  if (observation.band === "dark") {
    return { moodDelta: -3, reason: observation.reason };
  }

  return { moodDelta: 0, reason: observation.reason };
}

export function evaluateHealthFromThermalLoad(normalizedValue: number, reason: string): {
  healthDelta: number;
  reason: string;
} {
  let healthDelta = 0;
  let stateText = "熱環境は健康感を大きく揺らしていない。";

  if (normalizedValue >= 80) {
    healthDelta = -4;
    stateText = "熱がかなりこもり、健康感も落ちやすい。";
  } else if (normalizedValue >= 60) {
    healthDelta = -2;
    stateText = "少し熱がこもり、健康感にも負荷がある。";
  } else if (normalizedValue <= 20) {
    healthDelta = 3;
    stateText = "かなり涼しく、健康感が戻りやすい。";
  } else if (normalizedValue <= 40) {
    healthDelta = 1;
    stateText = "熱負荷は軽く、健康感を保ちやすい。";
  }

  return {
    healthDelta,
    reason: `${reason} ${stateText}`,
  };
}

export async function loadJmaWeatherObservationBundle(
  fetchWeather: () => Promise<JmaWeatherSnapshot> = fetchJmaWeatherSnapshot,
): Promise<JmaWeatherObservationBundle> {
  try {
    const weather = await fetchWeather();
    const causalInputs: EnvironmentCausalSourceInput[] = [];

    if (weather.temperature) {
      causalInputs.push({
        sourceId: "ambient_temperature",
        normalizedValue: weather.temperature.normalizedValue,
        reason: weather.temperature.reason,
      });
    }

    if (weather.humidity) {
      causalInputs.push({
        sourceId: "ambient_humidity",
        normalizedValue: weather.humidity.normalizedValue,
        reason: weather.humidity.reason,
      });
    }

    return {
      weather,
      causalInputs,
      errorMessage: null,
    };
  } catch (error) {
    return {
      weather: null,
      causalInputs: [],
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
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

async function getRoomBrightness(roiSpec: string): Promise<number | null> {
  try {
    const result = await $`uv run python ${BRIGHTNESS_SCRIPT} --roi ${roiSpec}`
      .cwd(WEBCAM_MCP_DIR)
      .quiet();
    const val = parseFloat(result.stdout.toString().trim());
    return isNaN(val) ? null : val;
  } catch {
    return null;
  }
}

// ── STATUS.md のフィールドを更新 ──

async function updateStatus(field: "energy" | "mood" | "health", delta: number, reason: string) {
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
  const brightnessBaselineFromMarkdown = markdownState?.aux.environment_brightness_baseline?.valueText;
  const brightnessSampleCountFromMarkdown = markdownState?.aux.environment_brightness_sample_count?.valueText;
  const brightnessRoiFromMarkdown = markdownState?.aux.environment_brightness_roi?.valueText;
  const previousBaseline = parseFloat(baselineFromMarkdown ?? "");
  const baseline = Number.isFinite(previousBaseline)
    ? previousBaseline
    : legacyState.energyTemperatureBaseline;
  const previousSampleCount = parseInt(sampleCountFromMarkdown ?? "", 10);
  const sampleCount = Number.isFinite(previousSampleCount)
    ? previousSampleCount
    : (legacyState.sampleCount ?? 0);
  const previousBrightnessBaseline = parseFloat(brightnessBaselineFromMarkdown ?? "");
  const brightnessBaseline = Number.isFinite(previousBrightnessBaseline)
    ? previousBrightnessBaseline
    : legacyState.brightnessBaseline;
  const previousBrightnessSampleCount = parseInt(brightnessSampleCountFromMarkdown ?? "", 10);
  const brightnessSampleCount = Number.isFinite(previousBrightnessSampleCount)
    ? previousBrightnessSampleCount
    : (legacyState.brightnessSampleCount ?? 0);
  const brightnessRoi = resolveBrightnessRoi(
    process.env.WARDROBE_BRIGHTNESS_ROI?.trim()
    || brightnessRoiFromMarkdown
    || legacyState.brightnessRoi
    || null
  );
  const brightnessRoiSpec = formatBrightnessRoiSpec(brightnessRoi);

  let nextState: EnvironmentState = { ...legacyState };
  let stateDirty = false;
  const causalInputs: EnvironmentCausalSourceInput[] = [];
  const fallbackUpdates: StatusFallbackUpdate[] = [];

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

    causalInputs.push({
      sourceId: "environment_thermal_load",
      normalizedValue: thermalLoad.normalizedValue,
      reason: thermalLoad.reason,
    });
    fallbackUpdates.push({
      field: "energy",
      delta: evaluation.energyDelta,
      reason: evaluation.reason,
    });
    const healthFallback = evaluateHealthFromThermalLoad(thermalLoad.normalizedValue, thermalLoad.reason);
    fallbackUpdates.push({
      field: "health",
      delta: healthFallback.healthDelta,
      reason: healthFallback.reason,
    });
  } else {
    console.log("[environment-tick] LHM unavailable, skipping temperature");
  }

  // カメラ明るさ → mood
  const brightness = await getRoomBrightness(brightnessRoiSpec);
  if (brightness !== null) {
    const nextBrightnessBaseline = computeBrightnessBaseline(brightnessBaseline, brightness);
    const brightnessObservation = describeBrightnessObservation(brightness, {
      baseline: nextBrightnessBaseline,
      roiSpec: brightnessRoiSpec,
    });
    console.log(
      `[environment-tick] Brightness: ${brightness.toFixed(1)}/255 ` +
      `(baseline ${nextBrightnessBaseline.toFixed(1)} / normalized ${brightnessObservation.normalizedValue}/100 / ROI ${brightnessRoiSpec})`
    );

    nextState = {
      ...nextState,
      lastBrightness: brightness,
      lastBrightnessNormalized: brightnessObservation.normalizedValue,
      lastBrightnessBand: brightnessObservation.band,
      lastBrightnessAt: new Date().toISOString(),
      brightnessBaseline: nextBrightnessBaseline,
      brightnessSampleCount: brightnessSampleCount + 1,
      brightnessRoi: brightnessRoiSpec,
      updatedAt: new Date().toISOString(),
    };
    stateDirty = true;

    await setEnvironmentObservation(
      "ambient_brightness",
      `${Math.round(brightness)} / 255`,
      brightnessObservation.normalizedValue,
      {
        source: "wifi-cam RTSP brightness (ROI)",
        reason: brightnessObservation.reason,
        recordHistoryOnUnchanged: true,
      }
    );
    await setEnvironmentAuxValue(
      "environment_brightness_baseline",
      `${formatDecimal(nextBrightnessBaseline)} / 255`,
      {
        note: "ROI 輝度の slow EMA 基準値（相対評価用）",
      }
    );
    await setEnvironmentAuxValue(
      "environment_brightness_sample_count",
      String(brightnessSampleCount + 1),
      {
        note: "baseline 算出に使ったサンプル数",
      }
    );
    await setEnvironmentAuxValue(
      "environment_brightness_roi",
      brightnessRoiSpec,
      {
        note: "normalized x,y,w,h",
      }
    );

    causalInputs.push({
      sourceId: "ambient_brightness",
      normalizedValue: brightnessObservation.normalizedValue,
      reason: brightnessObservation.reason,
    });
    const moodFallback = evaluateMoodFromBrightness(brightness, brightnessObservation);
    fallbackUpdates.push({
      field: "mood",
      delta: moodFallback.moodDelta,
      reason: moodFallback.reason,
    });
  } else {
    console.log("[environment-tick] Camera unavailable, skipping brightness");
  }

  // 気象庁アメダス → 気温 / 湿度
  const jmaWeather = await loadJmaWeatherObservationBundle();
  if (jmaWeather.weather) {
    const { weather } = jmaWeather;

    if (weather.temperature) {
      console.log(
        `[environment-tick] AMeDAS temperature (${weather.stationName}): ${weather.temperature.rawValue.toFixed(1)}°C`
      );
      await setEnvironmentObservation(
        "ambient_temperature",
        `${formatDecimal(weather.temperature.rawValue)} °C`,
        weather.temperature.normalizedValue,
        {
          observedAt: new Date(weather.temperature.observedAt),
          source: weather.temperature.source,
          reason: weather.temperature.reason,
          recordHistoryOnUnchanged: true,
        }
      );
    }

    if (weather.humidity) {
      console.log(
        `[environment-tick] AMeDAS humidity (${weather.stationName}): ${Math.round(weather.humidity.rawValue)}%`
      );
      await setEnvironmentObservation(
        "ambient_humidity",
        `${Math.round(weather.humidity.rawValue)} %`,
        weather.humidity.normalizedValue,
        {
          observedAt: new Date(weather.humidity.observedAt),
          source: weather.humidity.source,
          reason: weather.humidity.reason,
          recordHistoryOnUnchanged: true,
        }
      );
    }

    causalInputs.push(...jmaWeather.causalInputs);
  } else if (jmaWeather.errorMessage) {
    console.log(
      `[environment-tick] JMA weather unavailable, skipping ambient temperature/humidity: ${jmaWeather.errorMessage}`
    );
  }

  let runtimeApplied = false;
  if (causalInputs.length > 0) {
    try {
      const proposals = await deriveEnvironmentCausalProposals(causalInputs);
      runtimeApplied = true;

      try {
        await saveCausalRuntimeSnapshot(proposals);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[environment-tick] failed to save causal runtime snapshot: ${message}`);
      }

      if (proposals.length === 0) {
        console.log("[environment-tick] causal runtime produced no status proposals");
      }

      for (const proposal of proposals) {
        const deltaLabel = `${proposal.delta >= 0 ? "+" : ""}${proposal.delta}`;
        console.log(
          `[environment-tick] causal ${proposal.field}: ${proposal.topPathDescription} ` +
          `(score ${proposal.score.toFixed(2)} / delta ${deltaLabel})`
        );

        if (proposal.delta !== 0) {
          await updateStatus(proposal.field, proposal.delta, proposal.reason);
        } else {
          console.log(`[environment-tick] ${proposal.field} unchanged (causal runtime)`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[environment-tick] causal runtime failed, using fallback rules: ${message}`);
    }
  }

  if (!runtimeApplied) {
    for (const update of fallbackUpdates) {
      if (update.delta !== 0) {
        await updateStatus(update.field, update.delta, update.reason);
      } else {
        console.log(`[environment-tick] ${update.field} unchanged (fallback)`);
      }
    }
  }

  if (stateDirty) {
    await writeEnvironmentState(nextState);
  }

  await syncPersonaStructuredStore();
}

if (import.meta.main) {
  await main();
}
