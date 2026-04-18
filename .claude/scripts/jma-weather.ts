const JMA_AMEDAS_LATEST_TIME_URL = "https://www.jma.go.jp/bosai/amedas/data/latest_time.txt";
const JMA_AMEDAS_TABLE_URL = "https://www.jma.go.jp/bosai/amedas/const/amedastable.json";

const DEFAULT_AMEDAS_CODE = "44132";
const DEFAULT_STATION_NAME = "東京";

interface AmedasStationRow {
  kjName?: string;
  enName?: string;
}

interface AmedasStationTable {
  [code: string]: AmedasStationRow;
}

interface AmedasMapValue {
  temp?: [number | null, number | null] | null;
  humidity?: [number | null, number | null] | null;
}

interface AmedasMapResponse {
  [code: string]: AmedasMapValue;
}

export interface JmaTemperatureObservation {
  rawValue: number;
  normalizedValue: number;
  reason: string;
  source: string;
  stationName: string;
  observedAt: string;
}

export interface JmaHumidityObservation {
  rawValue: number;
  normalizedValue: number;
  reason: string;
  source: string;
  stationName: string;
  observedAt: string;
}

export interface JmaWeatherSnapshot {
  observedAt: string;
  stationCode: string;
  stationName: string;
  temperature: JmaTemperatureObservation | null;
  humidity: JmaHumidityObservation | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function firstNumber(value: [number | null, number | null] | null | undefined): number | null {
  const raw = value?.[0];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export function resolveJmaAmedasCode(): string {
  return process.env.WARDROBE_JMA_AMEDAS_CODE?.trim() || DEFAULT_AMEDAS_CODE;
}

export function formatJmaAmedasMapTimestamp(latestTimeText: string): string {
  const latest = latestTimeText.trim();
  const match = latest.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[+-]\d{2}:\d{2}|Z)?$/
  );
  if (!match) {
    throw new Error(`Invalid JMA latest_time.txt value: ${latest}`);
  }

  const [, y, m, d, hh, mm, ss] = match;
  return `${y}${m}${d}${hh}${mm}${ss}`;
}

export function normalizeAmbientTemperature(tempCelsius: number): number {
  return clamp(Math.round(50 + (tempCelsius - 22) * 4), 0, 100);
}

export function describeAmbientTemperature(
  tempCelsius: number,
  stationName = DEFAULT_STATION_NAME,
): JmaTemperatureObservation {
  const normalizedValue = normalizeAmbientTemperature(tempCelsius);
  let stateText = "過ごしやすい温度。";

  if (tempCelsius >= 30) {
    stateText = "かなり暑い。";
  } else if (tempCelsius >= 26) {
    stateText = "少し暑い。";
  } else if (tempCelsius <= 5) {
    stateText = "かなり冷える。";
  } else if (tempCelsius <= 12) {
    stateText = "少しひんやりしている。";
  }

  return {
    rawValue: tempCelsius,
    normalizedValue,
    reason: `気象庁アメダス ${stationName} ${tempCelsius.toFixed(1)}°C——${stateText}`,
    source: "JMA/AMeDAS",
    stationName,
    observedAt: "",
  };
}

export function describeAmbientHumidity(
  humidityPercent: number,
  stationName = DEFAULT_STATION_NAME,
): JmaHumidityObservation {
  const normalizedValue = clamp(Math.round(humidityPercent), 0, 100);
  let stateText = "湿度はおおむね落ち着いている。";

  if (humidityPercent >= 80) {
    stateText = "かなり蒸している。";
  } else if (humidityPercent >= 65) {
    stateText = "少し蒸す。";
  } else if (humidityPercent <= 30) {
    stateText = "かなり乾いている。";
  } else if (humidityPercent <= 45) {
    stateText = "少し乾いている。";
  } else if (humidityPercent <= 60) {
    stateText = "少ししっとりしている。";
  }

  return {
    rawValue: humidityPercent,
    normalizedValue,
    reason: `気象庁アメダス ${stationName} 湿度${Math.round(humidityPercent)}%——${stateText}`,
    source: "JMA/AMeDAS",
    stationName,
    observedAt: "",
  };
}

export async function fetchJmaWeatherSnapshot(
  fetchImpl: typeof fetch = fetch,
): Promise<JmaWeatherSnapshot> {
  const stationCode = resolveJmaAmedasCode();

  const latestTimeResponse = await fetchImpl(JMA_AMEDAS_LATEST_TIME_URL);
  if (!latestTimeResponse.ok) {
    throw new Error(`Failed to fetch JMA latest_time.txt: ${latestTimeResponse.status}`);
  }
  const latestTimeText = await latestTimeResponse.text();
  const observedAt = latestTimeText.trim();
  const mapTimestamp = formatJmaAmedasMapTimestamp(latestTimeText);

  const [stationTableResponse, mapResponse] = await Promise.all([
    fetchImpl(JMA_AMEDAS_TABLE_URL),
    fetchImpl(`https://www.jma.go.jp/bosai/amedas/data/map/${mapTimestamp}.json`),
  ]);

  if (!stationTableResponse.ok) {
    throw new Error(`Failed to fetch JMA amedastable.json: ${stationTableResponse.status}`);
  }
  if (!mapResponse.ok) {
    throw new Error(`Failed to fetch JMA map data: ${mapResponse.status}`);
  }

  const stationTable = await stationTableResponse.json() as AmedasStationTable;
  const weatherMap = await mapResponse.json() as AmedasMapResponse;

  const stationName = stationTable[stationCode]?.kjName || stationTable[stationCode]?.enName || DEFAULT_STATION_NAME;
  const stationData = weatherMap[stationCode];
  if (!stationData) {
    throw new Error(`JMA map data does not contain station code: ${stationCode}`);
  }

  const temp = firstNumber(stationData.temp);
  const humidity = firstNumber(stationData.humidity);

  const temperature = temp === null
    ? null
    : {
      ...describeAmbientTemperature(temp, stationName),
      observedAt,
    };
  const humidityObservation = humidity === null
    ? null
    : {
      ...describeAmbientHumidity(humidity, stationName),
      observedAt,
    };

  return {
    observedAt,
    stationCode,
    stationName,
    temperature,
    humidity: humidityObservation,
  };
}
