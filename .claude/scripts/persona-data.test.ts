import { describe, expect, test } from "bun:test";

import {
  buildLearnedSeedGraphSnapshot,
  buildDashboardSnapshotFromMarkdownDocuments,
  parseBodyDocument,
  parseSoulDocument,
  parseStatusDocument,
} from "./persona-data";

const SOUL_SAMPLE = `# SOUL.md

## Identity — 名前と来歴

名前: スミレ
一人称: 私

## Temperament — 不変の性格傾向 (Lv1-2)

**倫理観 (\`ethics\`): 85**
正直さを重視する。

**好奇心 (\`curiosity\`): 82**
新しいものを追う。
`;

const BODY_SAMPLE = `# BODY.md

## Lv1 — 不変の核

| 項目 | 値 |
|---|---|
| 誕生日 | 2013-04-05 |
| 性別 | 女 |

## Lv2 — 不可逆的な成長

| 項目 | 値 | 単位 | persona_time | recorded_at |
|---|---|---|---|---|
| 身長 | 160 | cm | 2026-04-05 | 2026-04-05 |
| 声の高さ | 200 | Hz | 2026-04-06 | 2026-04-06 |

### 成長履歴

| persona_time | recorded_at | 項目 | 変更前 | 変更後 | メモ |
|---|---|---|---|---|---|
| 2026-04-05 | 2026-04-05 | 身長 | — | 160 cm | 初期設定 |
`;

const STATUS_SAMPLE = `# STATUS.md

## Lv3-1 バイタル（生物的な可変データ）

| 項目 | 値 | 最終更新 | 取得方法 |
|---|---|---|---|
| 体重 | 48 kg | 2026-04-08 | 推定 |
| 睡眠時間 | 6.5 h | 2026-04-08 | センサー |

## Lv3-2 情緒・関係性（内省による可変データ）

| 項目 | 値 | 最終更新 | 根拠 |
|---|---|---|---|
| mood（気分） | 81 | 2026-04-13 11:00 | 明るい |
| energy（活力） | 24 | 2026-04-12 11:00 | 熱い |
| satiation（充足感） | 100 | 2026-04-13 11:00 | heartbeat |

## 変化履歴

| 日時 | 項目 | 変化前 | 変化後 | 理由 |
|---|---|---|---|---|
| 2026-04-13 11:00 | mood | 84 | 81 | 部屋が暗い |
| 2026-04-13 11:00 | 体重 | 47 kg | 48 kg | 再計測 |
`;

const ENVIRONMENT_SAMPLE = `# ENVIRONMENT.md

## 現在の環境

| 項目 | 生値 | 正規化値 | 最終更新 | 取得方法 | 根拠 |
|---|---|---|---|---|---|
| 環境熱負荷 proxy | 46.0 °C | 47 | 2026-04-18 11:00 | LHM/Core Max | 環境熱負荷 proxy 47/100（CPU 46.0°C） |
| 気温 | 16.3 °C | 27 | 2026-04-18 21:10 | 気象庁アメダス（東京） | 気象庁アメダス 東京 16.3°C |
| 湿度 | 72 % | 72 | 2026-04-18 21:10 | 気象庁アメダス（東京） | 気象庁アメダス 東京 湿度72% |

## 補助状態

| 項目 | 値 | 最終更新 | 備考 |
|---|---|---|---|
| 熱負荷 baseline | 46.7 °C | 2026-04-18 11:00 | Core Max の EMA 基準値 |

## 変化履歴

| 日時 | 項目 | 変化前 | 変化後 | 正規化値 | 理由 |
|---|---|---|---|---|---|
| 2026-04-18 21:10 | 気温 | — | 16.3 °C | 27 | 気象庁アメダス 東京 16.3°C |
| 2026-04-18 21:10 | 湿度 | — | 72 % | 72 | 気象庁アメダス 東京 湿度72% |
`;

describe("parseSoulDocument", () => {
  test("extracts identity and temperament metrics", () => {
    const parsed = parseSoulDocument(SOUL_SAMPLE);

    expect(parsed.meta.name).toBe("スミレ");
    expect(parsed.meta.firstPerson).toBe("私");
    expect(parsed.metrics.find((metric) => metric.key === "name")?.valueText).toBe("スミレ");
    expect(parsed.metrics.find((metric) => metric.key === "ethics")?.valueNumber).toBe(85);
    expect(parsed.metrics.find((metric) => metric.key === "curiosity")?.level).toBe("Lv1-2");
  });
});

describe("parseBodyDocument", () => {
  test("extracts Lv1 and Lv2 metrics plus growth history", () => {
    const parsed = parseBodyDocument(BODY_SAMPLE);

    expect(parsed.metrics.find((metric) => metric.key === "birth_date")?.valueText).toBe("2013-04-05");
    expect(parsed.metrics.find((metric) => metric.key === "height")?.unit).toBe("cm");
    expect(parsed.metrics.find((metric) => metric.key === "voice_pitch")?.valueNumber).toBe(200);
    expect(parsed.history).toHaveLength(1);
    expect(parsed.history[0]?.key).toBe("height");
    expect(parsed.history[0]?.nextValueNumber).toBe(160);
  });
});

describe("parseStatusDocument", () => {
  test("extracts vital, emotional, and history rows", () => {
    const parsed = parseStatusDocument(STATUS_SAMPLE);

    expect(parsed.metrics.find((metric) => metric.key === "weight")?.valueNumber).toBe(48);
    expect(parsed.metrics.find((metric) => metric.key === "sleep_time")?.unit).toBe("h");
    expect(parsed.metrics.find((metric) => metric.key === "mood")?.level).toBe("Lv3-2");
    expect(parsed.metrics.find((metric) => metric.key === "satiation")?.valueNumber).toBe(100);
    expect(parsed.history.find((entry) => entry.key === "mood")?.nextValueNumber).toBe(81);
    expect(parsed.history.find((entry) => entry.key === "weight")?.level).toBe("Lv3-1");
  });
});

describe("buildDashboardSnapshotFromMarkdownDocuments", () => {
  test("includes ambient temperature and humidity from ENVIRONMENT.md", () => {
    const snapshot = buildDashboardSnapshotFromMarkdownDocuments({
      soulText: SOUL_SAMPLE,
      bodyText: BODY_SAMPLE,
      statusText: STATUS_SAMPLE,
      environmentText: ENVIRONMENT_SAMPLE,
    });

    expect(snapshot.meta.name).toBe("スミレ");
    expect(snapshot.current.find((metric) => metric.key === "ambient_temperature")?.valueText).toBe("16.3 °C");
    expect(snapshot.current.find((metric) => metric.key === "ambient_humidity")?.valueNumber).toBe(72);
    expect(snapshot.history.find((entry) => entry.key === "ambient_humidity")?.nextValueText).toBe("72 %");
    expect(snapshot.observations.find((entry) => entry.key === "ambient_temperature")?.normalizedValue).toBe(27);
  });
});

describe("buildLearnedSeedGraphSnapshot", () => {
  test("builds nodes from causal seeds and learned edges", () => {
    const graph = buildLearnedSeedGraphSnapshot({
      causalSeedText: JSON.stringify({
        nodes: [
          { id: "mood", label: "mood", kind: "emotion", dataLevel: "Lv3-2" },
          { id: "energy", label: "energy", kind: "emotion", dataLevel: "Lv3-2" },
        ],
      }),
      learnedSeedText: JSON.stringify({
        learnedEdges: [
          {
            id: "learned_energy_mood_001",
            pair: ["mood", "energy"],
            source: "energy",
            target: "mood",
            direction: "energy->mood",
            relation: "lifts",
            causalLevel: "Lv2",
            weight: 0.3,
            status: "observing",
            evidenceCount: 17,
            positiveEvidenceCount: 12,
            negativeEvidenceCount: 4,
            neutralEvidenceCount: 1,
          },
        ],
      }),
      current: [],
    });

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["energy", "mood"]);
    expect(graph.edges[0]?.sourceId).toBe("energy");
    expect(graph.edges[0]?.targetId).toBe("mood");
    expect(graph.edges[0]?.evidenceCount).toBe(17);
  });

  test("keeps ambiguous learned pairs drawable", () => {
    const graph = buildLearnedSeedGraphSnapshot({
      causalSeedText: null,
      learnedSeedText: JSON.stringify({
        learnedEdges: [
          {
            id: "learned_mood_health_001",
            pair: ["mood", "health"],
            source: null,
            target: null,
            direction: "ambiguous",
            relation: "modulates",
            causalLevel: "Lv2",
            weight: 0.3,
            status: "observing",
            evidenceCount: 10,
          },
        ],
      }),
      current: [],
    });

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["health", "mood"]);
    expect(graph.edges[0]?.sourceId).toBeNull();
    expect(graph.edges[0]?.targetId).toBeNull();
    expect(graph.edges[0]?.pair).toEqual(["mood", "health"]);
  });
});
