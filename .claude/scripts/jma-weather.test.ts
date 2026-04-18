import { describe, expect, test } from "bun:test";

import {
  describeAmbientHumidity,
  describeAmbientTemperature,
  fetchJmaWeatherSnapshot,
  formatJmaAmedasMapTimestamp,
  normalizeAmbientTemperature,
} from "./jma-weather";

describe("jma-weather", () => {
  test("formats latest_time.txt into a map timestamp", () => {
    expect(formatJmaAmedasMapTimestamp("2026-04-18T11:00:00+09:00")).toBe("20260418110000");
  });

  test("normalizes ambient temperature around a neutral midpoint", () => {
    expect(normalizeAmbientTemperature(22)).toBe(50);
    expect(normalizeAmbientTemperature(30)).toBe(82);
    expect(normalizeAmbientTemperature(10)).toBe(2);
  });

  test("builds human-readable temperature and humidity observations", () => {
    const temperature = describeAmbientTemperature(24.6, "東京");
    const humidity = describeAmbientHumidity(72, "東京");

    expect(temperature.normalizedValue).toBe(60);
    expect(temperature.reason).toContain("東京");
    expect(humidity.normalizedValue).toBe(72);
    expect(humidity.reason).toContain("湿度72%");
  });

  test("fetches current temperature and humidity from JMA endpoints", async () => {
    const responses = new Map<string, Response>([
      [
        "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt",
        new Response("2026-04-18T11:00:00+09:00"),
      ],
      [
        "https://www.jma.go.jp/bosai/amedas/const/amedastable.json",
        new Response(JSON.stringify({
          "44132": {
            kjName: "東京",
            enName: "Tokyo",
          },
        })),
      ],
      [
        "https://www.jma.go.jp/bosai/amedas/data/map/20260418110000.json",
        new Response(JSON.stringify({
          "44132": {
            temp: [24.6, 0],
            humidity: [72, 0],
          },
        })),
      ],
    ]);

    const snapshot = await fetchJmaWeatherSnapshot(async (input) => {
      const url = String(input);
      const response = responses.get(url);
      if (!response) {
        return new Response("not found", { status: 404 });
      }
      return response;
    });

    expect(snapshot.stationCode).toBe("44132");
    expect(snapshot.stationName).toBe("東京");
    expect(snapshot.temperature?.rawValue).toBe(24.6);
    expect(snapshot.temperature?.normalizedValue).toBe(60);
    expect(snapshot.humidity?.rawValue).toBe(72);
    expect(snapshot.humidity?.normalizedValue).toBe(72);
  });
});
