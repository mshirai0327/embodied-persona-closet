/**
 * satiation-tick.ts — 充足感（satiation）の時間減衰
 *
 * autonomous-action.sh から heartbeat のたびに呼ばれる。
 * STATUS.md の satiation 値を最終更新からの経過時間に応じて減衰させる。
 *
 * 減衰率: -3 / 時間（24時間で ~72pt 減衰 → 空腹状態 <30 に自然に到達）
 * 閾値:
 *   >= 80: 満腹（消化優先）
 *   55-79: 適度
 *   30-54: やや空腹
 *   <  30: 空腹（探索欲UP）
 */

const SCRIPT_DIR = import.meta.dir;
const STATUS_PATH = `${SCRIPT_DIR}/../../STATUS.md`;
const DECAY_PER_HOUR = 3;

async function main() {
  const file = Bun.file(STATUS_PATH);
  if (!(await file.exists())) return;

  const text = await file.text();

  // satiation 行を探す
  const match = text.match(
    /(\| satiation（充足感） \| )(\d+)( \| )(\d{4}-\d{2}-\d{2} \d{2}:\d{2})( \|[^\n]*)/
  );
  if (!match) return;

  const currentValue = parseInt(match[2]);
  const lastUpdated = match[4]; // "YYYY-MM-DD HH:mm"

  // 経過時間を計算
  const lastDate = new Date(lastUpdated);
  const now = new Date();
  const elapsedHours = (now.getTime() - lastDate.getTime()) / 3_600_000;

  if (elapsedHours < 0.5) return; // 30分未満は無視

  // 減衰計算
  const decay = Math.round(elapsedHours * DECAY_PER_HOUR);
  const newValue = Math.max(0, currentValue - decay);

  if (newValue === currentValue) return; // 変化なし

  const nowStr = now.toISOString().slice(0, 16).replace("T", " ");
  const reason =
    newValue >= 80 ? "満ちている。消化したい感覚がある。" :
    newValue >= 55 ? "適度に満たされている。" :
    newValue >= 30 ? "何かを欲している。" :
    "空っぽに近い。新しいものを探したい。";

  // satiation 行を更新
  let updated = text.replace(
    /\| satiation（充足感） \| \d+ \| [\d]{4}-[\d]{2}-[\d]{2} [\d]{2}:[\d]{2} \|[^\n]*/,
    `| satiation（充足感） | ${newValue} | ${nowStr} | 時間経過による自動減衰（-${decay}）。${reason} |`
  );

  // 変化履歴に追記（最初の | 日時 | 行の直前に挿入）
  const historyEntry = `| ${nowStr} | satiation | ${currentValue} | ${newValue} | 時間経過（${elapsedHours.toFixed(1)}h）自動減衰 |\n`;
  updated = updated.replace(
    /(\| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| satiation \|)/,
    historyEntry + "$1"
  );
  // 変化履歴に satiation エントリがまだない場合は先頭行の前に挿入
  if (!updated.includes(historyEntry)) {
    updated = updated.replace(
      /(\| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \| (?!satiation))/,
      historyEntry + "$1"
    );
  }

  await Bun.write(STATUS_PATH, updated);
  console.log(`[satiation-tick] ${currentValue} → ${newValue} (-${decay} / ${elapsedHours.toFixed(1)}h elapsed)`);

  // satiation が30を下回ったとき、「探索」欲望をboostする
  if (newValue < 30 && currentValue >= 30) {
    const DESIRES_PATH = `${SCRIPT_DIR}/../../desires.json`;
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
