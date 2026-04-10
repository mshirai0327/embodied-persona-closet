/**
 * satiation-tick.ts — 充足感（satiation）の時間調整
 *
 * autonomous-action.sh から heartbeat のたびに呼ばれる。
 * STATUS.md の satiation 値を、最終更新からの経過時間に応じて減衰させつつ、
 * heartbeat 実行そのものを小さな摂取として扱う。
 *
 * 減衰率: -3 / 時間（24時間で ~72pt 減衰 → 空腹状態 <30 に自然に到達）
 * 基本摂取: +3 / 時間（elapsedHours に応じて加算、ただし satiation >= 80 では加算しない）
 * 閾値:
 *   >= 80: 満腹（消化優先）
 *   55-79: 適度
 *   30-54: やや空腹
 *   <  30: 空腹（探索欲UP）
 */

import { readStatusSnapshot, setStatusValue } from "./status-store";

const SCRIPT_DIR = import.meta.dir;
const DECAY_PER_HOUR = 3;
const INTAKE_PER_HOUR = 3;
const INTAKE_CAP = 80;
const DESIRES_PATH = process.env.WARDROBE_DESIRES_PATH?.trim() ?? `${SCRIPT_DIR}/../../desires.json`;

async function main() {
  const snapshot = await readStatusSnapshot();
  const satiation = snapshot?.satiation;
  if (!satiation) return;

  const currentValue = satiation.value;
  const lastUpdated = satiation.updatedAt;

  // 経過時間を計算
  const lastDate = new Date(lastUpdated);
  const now = new Date();
  const elapsedHours = (now.getTime() - lastDate.getTime()) / 3_600_000;

  if (elapsedHours < 0.5) return; // 30分未満は無視

  // 減衰計算
  const decay = Math.round(elapsedHours * DECAY_PER_HOUR);
  const intake =
    currentValue < INTAKE_CAP
      ? Math.round(elapsedHours * INTAKE_PER_HOUR)
      : 0;
  const newValue = Math.max(0, Math.min(100, currentValue - decay + intake));

  const stateText =
    newValue >= 80 ? "満ちている。消化したい感覚がある。" :
    newValue >= 55 ? "適度に満たされている。" :
    newValue >= 30 ? "何かを欲している。" :
    "空っぽに近い。新しいものを探したい。";

  const adjustmentParts = [`時間経過による自動減衰（-${decay}）`];
  if (intake > 0) {
    adjustmentParts.push(`heartbeat実行による小さな摂取（+${intake}）`);
  }

  const result = await setStatusValue("satiation", newValue, {
    now,
    reason: `${adjustmentParts.join(" + ")}。${stateText}`,
    updateTimestampOnUnchanged: true,
  });
  if (!result) return;

  const signedIntake = intake > 0 ? ` +${intake}` : "";
  console.log(
    `[satiation-tick] ${result.previousValue} → ${result.nextValue} (-${decay}${signedIntake} / ${elapsedHours.toFixed(1)}h elapsed)`
  );

  // satiation が30を下回ったとき、「探索」欲望をboostする
  if (result.nextValue < 30 && result.previousValue >= 30) {
    const desiresFile = Bun.file(DESIRES_PATH);
    if (await desiresFile.exists()) {
      try {
        const desiresState = await desiresFile.json() as { desires: Record<string, number>; lastTick: number };
        const prev = desiresState.desires["探索"] ?? 0;
        desiresState.desires["探索"] = Math.min(1.0, prev + 0.4);
        await Bun.write(DESIRES_PATH, JSON.stringify(desiresState, null, 2));
        console.log(`[satiation-tick] 探索欲boost: ${prev.toFixed(3)} → ${desiresState.desires["探索"].toFixed(3)}`);
      } catch {
        // desires.json が壊れていても無視
      }
    }
  }
}

await main();
