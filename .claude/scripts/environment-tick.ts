/**
 * environment-tick.ts — 環境センサーから STATUS.md を更新
 *
 * autonomous-action.sh から heartbeat のたびに呼ばれる。
 * 環境データを受動的に受け取り、内的状態（STATUS.md）を変化させる。
 *
 * 現在の知覚源:
 *   - システム温度 (LHM HTTP API, port 8085) → energy
 *
 * CPU Core Max 温度 → energy への影響:
 *   > 85°C : -8  (かなり熱い、消耗が速い)
 *   75-85°C: -4  (温かい、じわじわ疲れる)
 *   < 75°C : 0   (変化なし)
 */

const SCRIPT_DIR = import.meta.dir;
const STATUS_PATH = `${SCRIPT_DIR}/../../STATUS.md`;
const LHM_URL = "http://localhost:8085/data.json";

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

// ── STATUS.md の energy 行を更新 ──

async function updateEnergy(delta: number, reason: string) {
  const file = Bun.file(STATUS_PATH);
  if (!(await file.exists())) return;
  const text = await file.text();
  const lines = text.split("\n");

  const nowStr = new Date().toISOString().slice(0, 16).replace("T", " ");
  let energyValue: number | null = null;
  let updatedLines: string[] | null = null;

  // energy 行を探して更新
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\| energy（活力） \| (\d+) \|/);
    if (m) {
      energyValue = parseInt(m[1]);
      const newVal = Math.max(0, Math.min(100, energyValue + delta));
      if (newVal === energyValue) return; // 変化なし
      lines[i] = `| energy（活力） | ${newVal} | ${nowStr} | ${reason} |`;
      updatedLines = lines;
      console.log(`[environment-tick] energy: ${energyValue} → ${newVal} (${delta > 0 ? "+" : ""}${delta})`);
      // 変化履歴の先頭に追記
      const historyEntry = `| ${nowStr} | energy | ${energyValue} | ${newVal} | ${reason} |`;
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].match(/^\| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \|/)) {
          updatedLines.splice(j, 0, historyEntry);
          break;
        }
      }
      break;
    }
  }

  if (updatedLines) {
    await Bun.write(STATUS_PATH, updatedLines.join("\n"));
  }
}

// ── メイン ──

async function main() {
  const coreMax = await getCpuCoreMax();

  if (coreMax === null) {
    console.log("[environment-tick] LHM unavailable, skipping");
    return;
  }

  console.log(`[environment-tick] Core Max: ${coreMax}°C`);

  if (coreMax > 85) {
    await updateEnergy(-8, `CPU ${coreMax}°C——かなり熱い。消耗が速い。`);
  } else if (coreMax > 75) {
    await updateEnergy(-4, `CPU ${coreMax}°C——温かい。じわじわ疲れる。`);
  }
}

await main();
