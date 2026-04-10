/**
 * environment-tick.ts — 環境センサーから STATUS.md を更新
 *
 * autonomous-action.sh から heartbeat のたびに呼ばれる。
 * 環境データを受動的に受け取り、内的状態（STATUS.md）を変化させる。
 *
 * 知覚源:
 *   - システム温度 (LHM HTTP API, port 8085) → energy
 *   - カメラ明るさ (usb-webcam-mcp, capture-brightness.py) → mood
 *
 * CPU Core Max 温度 → energy:
 *   > 85°C : -8  (かなり熱い、消耗が速い)
 *   75-85°C: -4  (温かい、じわじわ疲れる)
 *   < 75°C : +2  (涼しい、少し回復)
 *   深夜0-5時かつ < 75°C: +5 (静かな時間帯の回復)
 *
 * カメラ平均輝度 (0-255) → mood:
 *   > 150 : +2  (明るい空間)
 *   50-150: 0   (変化なし)
 *   < 50  : -3  (暗い部屋)
 */

import { $ } from "bun";

import { adjustStatusValue } from "./status-store";

const SCRIPT_DIR = import.meta.dir;
const LHM_URL = "http://localhost:8085/data.json";
const WEBCAM_MCP_DIR = `${SCRIPT_DIR}/../mcps/usb-webcam-mcp`;
const BRIGHTNESS_SCRIPT = `${SCRIPT_DIR}/capture-brightness.py`;

// ── センサー取得 ──

async function getCpuCoreMax(): Promise<number | null> {
  try {
    const res = await fetch(LHM_URL, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;

    function findCoreMax(node: Record<string, unknown>): number | null {
      const name = String(node.Text ?? "");
      const val = String(node.Value ?? "");
      if (name === "Core Max" && val.includes("°")) {
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
  // CPU 温度 → energy
  const coreMax = await getCpuCoreMax();
  if (coreMax !== null) {
    console.log(`[environment-tick] Core Max: ${coreMax}°C`);
    if (coreMax > 85) {
      await updateStatus("energy", -8, `CPU ${coreMax}°C——かなり熱い。消耗が速い。`);
    } else if (coreMax > 75) {
      await updateStatus("energy", -4, `CPU ${coreMax}°C——温かい。じわじわ疲れる。`);
    } else {
      // 低温時は回復。深夜帯（0-5時）はより大きく回復
      const hour = new Date().getHours();
      const isLateNight = hour >= 0 && hour < 5;
      if (isLateNight) {
        await updateStatus("energy", 5, `CPU ${coreMax}°C——涼しい。深夜の静けさの中で回復している。`);
      } else {
        await updateStatus("energy", 2, `CPU ${coreMax}°C——涼しい。少し回復している。`);
      }
    }
  } else {
    console.log("[environment-tick] LHM unavailable, skipping temperature");
  }

  // カメラ明るさ → mood
  const brightness = await getRoomBrightness();
  if (brightness !== null) {
    console.log(`[environment-tick] Brightness: ${brightness.toFixed(1)}/255`);
    if (brightness > 150) {
      await updateStatus("mood", 2, `部屋が明るい（輝度${brightness.toFixed(0)}）。`);
    } else if (brightness < 50) {
      await updateStatus("mood", -3, `部屋が暗い（輝度${brightness.toFixed(0)}）。`);
    }
  } else {
    console.log("[environment-tick] Camera unavailable, skipping brightness");
  }
}

await main();
