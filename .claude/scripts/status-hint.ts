/**
 * status-hint.ts — STATUS.md を読んで heartbeat 行動ヒントを生成する
 *
 * autonomous-action.sh から呼ばれ、STATUS.md の satiation/energy/mood から
 * 「今どんな行動が向いているか」を自然言語で1行出力する。
 *
 * 出力例:
 *   [STATUS] satiation=8（空腹）energy=34（消耗気味）→ 軽めの探索か intake が向いている。重いタスクは避ける。
 */

import { readStatusSnapshot } from "./status-store";

async function main() {
  const snapshot = await readStatusSnapshot();
  if (!snapshot) return;

  const satiation = snapshot.satiation?.value ?? 50;
  const energy = snapshot.energy?.value ?? 50;
  const mood = snapshot.mood?.value ?? 50;

  // 状態ラベル
  const sLabel = satiation < 30 ? "空腹" : satiation > 70 ? "満腹" : "適度";
  const eLabel = energy < 45 ? "消耗気味" : energy > 70 ? "元気" : "標準";

  // 行動カテゴリの優先・抑制を決める
  const prefer: string[] = [];
  const avoid: string[] = [];

  if (satiation < 30) {
    prefer.push("explore（探索）", "intake（読む・取り込む）");
  } else if (satiation > 70) {
    prefer.push("digest（整理・消化）", "reflect（振り返り）");
    avoid.push("create（焦らない）");
  }

  if (energy < 45) {
    prefer.push("maintain（軽い保守）");
    avoid.push("create（重いタスク避ける）");
  } else if (mood > 72) {
    prefer.push("create（作る）", "explore（掘り下げる）");
  }

  if (mood < 50) {
    prefer.push("digest（内側を整える）");
    avoid.push("connect（ネガティブを出さない）");
  }

  const preferStr = prefer.length > 0 ? `優先: ${prefer.join(" / ")}` : "";
  const avoidStr  = avoid.length  > 0 ? `避ける: ${avoid.join(" / ")}` : "";
  const hint = [preferStr, avoidStr].filter(Boolean).join("。");

  const line = `[STATUS] satiation=${satiation}（${sLabel}）energy=${energy}（${eLabel}）mood=${mood} → ${hint || "特に偏りなし。自由に選ぶ。"}`;
  console.log(line);
}

await main();
