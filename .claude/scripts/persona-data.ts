#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  ENVIRONMENT_FIELDS,
  parseEnvironmentDocument,
  setEnvironmentAuxValue,
  setEnvironmentObservation,
} from "./environment-store";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");

const DEFAULT_SOUL_PATH = resolve(PROJECT_ROOT, "SOUL.md");
const DEFAULT_BODY_PATH = resolve(PROJECT_ROOT, "BODY.md");
const DEFAULT_STATUS_PATH = resolve(PROJECT_ROOT, "STATUS.md");
const DEFAULT_ENVIRONMENT_PATH = resolve(PROJECT_ROOT, "ENVIRONMENT.md");
const DEFAULT_CAUSAL_SEED_PATH = resolve(PROJECT_ROOT, ".claude/persona/causal-seeds.json");

export const PERSONA_DB_PATH =
  process.env.WARDROBE_PERSONA_DB_PATH?.trim()
  ?? resolve(PROJECT_ROOT, ".claude/workingDirs/persona-status.sqlite");

export type PersonaLevel = "Lv0" | "Lv1-1" | "Lv1-2" | "Lv2" | "Lv3-1" | "Lv3-2";
export type PersonaDomain = "environment" | "identity" | "temperament" | "body" | "status";
export type PersonaSourceType = "markdown" | "sensor" | "proxy" | "seed";
export type CausalNodeKind =
  | "environment"
  | "sensor"
  | "vital"
  | "emotion"
  | "latent"
  | "action"
  | "outcome";
export type CausalLevel = "Lv1" | "Lv2" | "Lv3";

export interface PersonaMetric {
  key: string;
  label: string;
  level: PersonaLevel;
  domain: PersonaDomain;
  valueText: string | null;
  valueNumber: number | null;
  unit: string | null;
  sourceFile: string;
  sourceType: PersonaSourceType;
  observedAt: string | null;
  personaTime: string | null;
  recordedAt: string | null;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PersonaHistoryEntry {
  key: string;
  label: string;
  level: PersonaLevel;
  domain: PersonaDomain;
  previousValueText: string | null;
  previousValueNumber: number | null;
  nextValueText: string | null;
  nextValueNumber: number | null;
  unit: string | null;
  changedAt: string | null;
  sourceFile: string;
  sourceType: PersonaSourceType;
  reason: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PersonaMeta {
  name?: string;
  firstPerson?: string;
}

export interface ParsedSoulDocument {
  meta: PersonaMeta;
  metrics: PersonaMetric[];
}

export interface ParsedBodyDocument {
  metrics: PersonaMetric[];
  history: PersonaHistoryEntry[];
}

export interface ParsedStatusDocument {
  metrics: PersonaMetric[];
  history: PersonaHistoryEntry[];
}

export interface ParsedEnvironmentDocument {
  metrics: PersonaMetric[];
  history: PersonaHistoryEntry[];
}

export interface EnvironmentObservationInput {
  key: string;
  label: string;
  normalizedValue: number | null;
  rawValue: number | null;
  unit?: string | null;
  observedAt?: string;
  source?: string;
  sourceType?: Extract<PersonaSourceType, "sensor" | "proxy" | "markdown">;
  reason?: string | null;
  statusTarget?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface EnvironmentObservationRow {
  id: number;
  key: string;
  label: string;
  source: string;
  sourceType: string;
  observedAt: string;
  rawValueText: string | null;
  normalizedValue: number | null;
  reason: string | null;
}

export interface CausalNode {
  id: string;
  label: string;
  kind: CausalNodeKind;
  dataLevel: PersonaLevel | null;
  description?: string;
}

export interface CausalEdge {
  source: string;
  target: string;
  relation: string;
  causalLevel: CausalLevel;
  weight: number;
  description?: string;
}

interface DashboardMetricRow {
  key: string;
  label: string;
  level: PersonaLevel;
  domain: PersonaDomain;
  valueText: string | null;
  valueNumber: number | null;
  unit: string | null;
  sourceFile: string;
  sourceType: PersonaSourceType;
  observedAt: string | null;
  personaTime: string | null;
  recordedAt: string | null;
  reason: string | null;
  metadataJson: string | null;
}

interface DashboardHistoryRow {
  key: string;
  label: string;
  level: PersonaLevel;
  domain: PersonaDomain;
  previousValueText: string | null;
  previousValueNumber: number | null;
  nextValueText: string | null;
  nextValueNumber: number | null;
  unit: string | null;
  changedAt: string | null;
  sourceFile: string;
  sourceType: PersonaSourceType;
  reason: string | null;
}

interface DashboardMetaRow {
  key: string;
  value: string;
}

interface DashboardNodeRow {
  id: string;
  label: string;
  kind: CausalNodeKind;
  dataLevel: PersonaLevel | null;
  description: string | null;
}

interface DashboardEdgeRow {
  sourceId: string;
  targetId: string;
  relation: string;
  causalLevel: CausalLevel;
  weight: number;
  description: string | null;
}

const BODY_LV1_FIELDS: Record<
  string,
  { key: string; label: string; domain: PersonaDomain; level: PersonaLevel }
> = {
  誕生日: { key: "birth_date", label: "誕生日", domain: "identity", level: "Lv1-1" },
  性別: { key: "gender", label: "性別", domain: "identity", level: "Lv1-1" },
  血液型: { key: "blood_type", label: "血液型", domain: "identity", level: "Lv1-1" },
  クロノタイプ: { key: "chronotype", label: "クロノタイプ", domain: "identity", level: "Lv1-1" },
  苦味感受性: { key: "bitterness_sense", label: "苦味感受性", domain: "identity", level: "Lv1-1" },
  "知能（相対）": { key: "intelligence", label: "知能（相対）", domain: "identity", level: "Lv1-1" },
};

const BODY_LV2_FIELDS: Record<string, { key: string; label: string }> = {
  身長: { key: "height", label: "身長" },
  骨密度: { key: "bone_density", label: "骨密度" },
  "握力（最大筋力）": { key: "grip_strength", label: "握力（最大筋力）" },
  声の高さ: { key: "voice_pitch", label: "声の高さ" },
  "視力（右）": { key: "eyesight_right", label: "視力（右）" },
  "視力（左）": { key: "eyesight_left", label: "視力（左）" },
  聴力: { key: "hearing_ability", label: "聴力" },
};

const STATUS_VITAL_FIELDS: Record<string, { key: string; label: string }> = {
  体重: { key: "weight", label: "体重" },
  体脂肪率: { key: "body_fat_percentage", label: "体脂肪率" },
  体温: { key: "body_temperature", label: "体温" },
  血糖値: { key: "blood_sugar", label: "血糖値" },
  血圧: { key: "blood_pressure", label: "血圧" },
  血圧上: { key: "blood_pressure_sys", label: "血圧上" },
  血圧下: { key: "blood_pressure_dia", label: "血圧下" },
  睡眠時間: { key: "sleep_time", label: "睡眠時間" },
  睡眠質: { key: "sleep_quality", label: "睡眠質" },
};

const STATUS_EMOTION_FIELDS: Record<string, { key: string; label: string }> = {
  "mood（気分）": { key: "mood", label: "mood（気分）" },
  "energy（活力）": { key: "energy", label: "energy（活力）" },
  "health（健康感）": { key: "health", label: "health（健康感）" },
  "trust_mizuho（信頼）": { key: "trust_mizuho", label: "trust_mizuho（信頼）" },
  "satiation（充足感）": { key: "satiation", label: "satiation（充足感）" },
  "trust（信頼）": { key: "trust", label: "trust（信頼）" },
  "friendliness（親しみやすさ）": { key: "friendliness", label: "friendliness（親しみやすさ）" },
};

const STATUS_HISTORY_FIELDS: Record<string, { key: string; label: string; level: PersonaLevel }> = {
  mood: { key: "mood", label: "mood（気分）", level: "Lv3-2" },
  energy: { key: "energy", label: "energy（活力）", level: "Lv3-2" },
  health: { key: "health", label: "health（健康感）", level: "Lv3-2" },
  trust_mizuho: { key: "trust_mizuho", label: "trust_mizuho（信頼）", level: "Lv3-2" },
  trust: { key: "trust", label: "trust（信頼）", level: "Lv3-2" },
  friendliness: { key: "friendliness", label: "friendliness（親しみやすさ）", level: "Lv3-2" },
  satiation: { key: "satiation", label: "satiation（充足感）", level: "Lv3-2" },
  weight: { key: "weight", label: "体重", level: "Lv3-1" },
  body_temperature: { key: "body_temperature", label: "体温", level: "Lv3-1" },
  sleep_time: { key: "sleep_time", label: "睡眠時間", level: "Lv3-1" },
  sleep_quality: { key: "sleep_quality", label: "睡眠質", level: "Lv3-1" },
  blood_sugar: { key: "blood_sugar", label: "血糖値", level: "Lv3-1" },
  体重: { key: "weight", label: "体重", level: "Lv3-1" },
  体温: { key: "body_temperature", label: "体温", level: "Lv3-1" },
  睡眠時間: { key: "sleep_time", label: "睡眠時間", level: "Lv3-1" },
  睡眠質: { key: "sleep_quality", label: "睡眠質", level: "Lv3-1" },
  血糖値: { key: "blood_sugar", label: "血糖値", level: "Lv3-1" },
};

function normalizeCell(value: string | undefined): string | null {
  if (value === undefined) return null;
  const cleaned = value.replace(/<!--.*?-->/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "—") return null;
  return cleaned;
}

function parseNumber(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractUnitFromValue(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?\s*([^\d\s].*)$/);
  return match ? match[1].trim() : null;
}

function parsePipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function extractSection(text: string, heading: string): string {
  const lines = text.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === heading);
  if (startIndex === -1) return "";

  const hashMatch = heading.match(/^(#+)\s/);
  const currentLevel = hashMatch ? hashMatch[1].length : 2;
  const sectionLines: string[] = [];

  for (let index = startIndex + 1; index < lines.length; index++) {
    const line = lines[index];
    const nextHeading = line.match(/^(#+)\s/);
    if (nextHeading && nextHeading[1].length <= currentLevel) {
      break;
    }
    sectionLines.push(line);
  }

  return sectionLines.join("\n");
}

function extractTableBlocks(sectionText: string): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const rawLine of sectionText.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("|")) {
      current.push(line);
      continue;
    }

    if (current.length > 0) {
      blocks.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function parseMarkdownTable(block: string[]): Array<Record<string, string>> {
  if (block.length < 2) return [];

  const headers = parsePipeRow(block[0]);
  const rows: Array<Record<string, string>> = [];

  for (const line of block.slice(2)) {
    const values = parsePipeRow(line);
    if (values.length === 0) continue;

    const row: Record<string, string> = {};
    for (const [index, header] of headers.entries()) {
      row[header] = values[index] ?? "";
    }
    rows.push(row);
  }

  return rows;
}

function firstTable(sectionText: string): Array<Record<string, string>> {
  const block = extractTableBlocks(sectionText)[0];
  return block ? parseMarkdownTable(block) : [];
}

function toJson(value: Record<string, unknown> | null | undefined): string | null {
  return value ? JSON.stringify(value) : null;
}

function openPersonaDb(): Database {
  mkdirSync(dirname(PERSONA_DB_PATH), { recursive: true });
  const db = new Database(PERSONA_DB_PATH);
  ensurePersonaSchema(db);
  return db;
}

export function ensurePersonaSchema(db: Database): void {
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS persona_current (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      level TEXT NOT NULL,
      domain TEXT NOT NULL,
      value_text TEXT,
      value_number REAL,
      unit TEXT,
      source_file TEXT NOT NULL,
      source_type TEXT NOT NULL,
      observed_at TEXT,
      persona_time TEXT,
      recorded_at TEXT,
      reason TEXT,
      metadata_json TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS persona_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      level TEXT NOT NULL,
      domain TEXT NOT NULL,
      previous_value_text TEXT,
      previous_value_number REAL,
      next_value_text TEXT,
      next_value_number REAL,
      unit TEXT,
      changed_at TEXT,
      source_file TEXT NOT NULL,
      source_type TEXT NOT NULL,
      reason TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_persona_history_key_changed_at
      ON persona_history(key, changed_at);

    CREATE TABLE IF NOT EXISTS environment_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      source TEXT NOT NULL,
      source_type TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      raw_value REAL,
      normalized_value REAL,
      unit TEXT,
      status_target TEXT,
      reason TEXT,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_environment_observations_key_observed_at
      ON environment_observations(key, observed_at);

    CREATE TABLE IF NOT EXISTS causal_nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      data_level TEXT,
      description TEXT,
      source_type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS causal_edges (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      causal_level TEXT NOT NULL,
      weight REAL NOT NULL,
      description TEXT,
      source_type TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, relation, source_type)
    );

    CREATE TABLE IF NOT EXISTS persona_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

function readPathOrNull(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return file.exists().then(async (exists) => (exists ? file.text() : null));
}

export function parseSoulDocument(text: string): ParsedSoulDocument {
  const metrics: PersonaMetric[] = [];
  const meta: PersonaMeta = {};

  const name = normalizeCell(text.match(/^名前:\s*(.+)$/m)?.[1]);
  const firstPerson = normalizeCell(text.match(/^一人称:\s*(.+)$/m)?.[1]);
  if (name) {
    meta.name = name;
    metrics.push({
      key: "name",
      label: "名前",
      level: "Lv1-1",
      domain: "identity",
      valueText: name,
      valueNumber: null,
      unit: null,
      sourceFile: "SOUL.md",
      sourceType: "markdown",
      observedAt: null,
      personaTime: null,
      recordedAt: null,
      reason: "Identity セクション",
    });
  }
  if (firstPerson) {
    meta.firstPerson = firstPerson;
  }

  const temperamentSection = extractSection(text, "## Temperament — 不変の性格傾向 (Lv1-2)");
  const temperamentMatches = temperamentSection.matchAll(
    /\*\*([^*(]+?)\s+\(`([^`]+)`\):\s*(\d+)\*\*/g
  );

  for (const match of temperamentMatches) {
    const label = normalizeCell(match[1]);
    const key = normalizeCell(match[2]);
    const score = normalizeCell(match[3]);
    if (!label || !key || !score) continue;

    metrics.push({
      key,
      label,
      level: "Lv1-2",
      domain: "temperament",
      valueText: score,
      valueNumber: Number(score),
      unit: "score",
      sourceFile: "SOUL.md",
      sourceType: "markdown",
      observedAt: null,
      personaTime: null,
      recordedAt: null,
      reason: "Temperament セクション",
    });
  }

  return { meta, metrics };
}

export function parseBodyDocument(text: string): ParsedBodyDocument {
  const metrics: PersonaMetric[] = [];
  const history: PersonaHistoryEntry[] = [];

  for (const row of firstTable(extractSection(text, "## Lv1 — 不変の核"))) {
    const item = normalizeCell(row["項目"]);
    const valueText = normalizeCell(row["値"]);
    if (!item || !valueText) continue;

    const field = BODY_LV1_FIELDS[item];
    if (!field) continue;

    metrics.push({
      key: field.key,
      label: field.label,
      level: field.level,
      domain: field.domain,
      valueText,
      valueNumber: parseNumber(valueText),
      unit: extractUnitFromValue(valueText),
      sourceFile: "BODY.md",
      sourceType: "markdown",
      observedAt: null,
      personaTime: null,
      recordedAt: null,
      reason: "BODY.md Lv1",
    });
  }

  for (const row of firstTable(extractSection(text, "## Lv2 — 不可逆的な成長"))) {
    const item = normalizeCell(row["項目"]);
    if (!item) continue;

    const field = BODY_LV2_FIELDS[item];
    if (!field) continue;

    const valueText = normalizeCell(row["値"]);
    const unit = normalizeCell(row["単位"]);

    metrics.push({
      key: field.key,
      label: field.label,
      level: "Lv2",
      domain: "body",
      valueText,
      valueNumber: parseNumber(valueText),
      unit,
      sourceFile: "BODY.md",
      sourceType: "markdown",
      observedAt: normalizeCell(row.recorded_at),
      personaTime: normalizeCell(row.persona_time),
      recordedAt: normalizeCell(row.recorded_at),
      reason: "BODY.md Lv2",
    });
  }

  for (const row of firstTable(extractSection(text, "### 成長履歴"))) {
    const item = normalizeCell(row["項目"]);
    if (!item) continue;

    const field = BODY_LV2_FIELDS[item] ?? { key: item, label: item };
    const previousValueText = normalizeCell(row["変更前"]);
    const nextValueText = normalizeCell(row["変更後"]);

    history.push({
      key: field.key,
      label: field.label,
      level: "Lv2",
      domain: "body",
      previousValueText,
      previousValueNumber: parseNumber(previousValueText),
      nextValueText,
      nextValueNumber: parseNumber(nextValueText),
      unit: extractUnitFromValue(nextValueText),
      changedAt: normalizeCell(row.recorded_at) ?? normalizeCell(row.persona_time),
      sourceFile: "BODY.md",
      sourceType: "markdown",
      reason: normalizeCell(row["メモ"]),
      metadata: {
        personaTime: normalizeCell(row.persona_time),
        recordedAt: normalizeCell(row.recorded_at),
      },
    });
  }

  return { metrics, history };
}

function resolveStatusHistoryField(rawField: string): {
  key: string;
  label: string;
  level: PersonaLevel;
  domain: PersonaDomain;
} | null {
  const normalized = normalizeCell(rawField);
  if (!normalized) return null;

  const known = STATUS_HISTORY_FIELDS[normalized];
  if (known) {
    return {
      key: known.key,
      label: known.label,
      level: known.level,
      domain: "status",
    };
  }

  return {
    key: normalized,
    label: normalized,
    level: "Lv3-2",
    domain: "status",
  };
}

export function parseStatusDocument(text: string): ParsedStatusDocument {
  const metrics: PersonaMetric[] = [];
  const history: PersonaHistoryEntry[] = [];

  for (const row of firstTable(extractSection(text, "## Lv3-1 バイタル（生物的な可変データ）"))) {
    const item = normalizeCell(row["項目"]);
    if (!item) continue;

    const field = STATUS_VITAL_FIELDS[item];
    if (!field) continue;

    const valueText = normalizeCell(row["値"]);

    metrics.push({
      key: field.key,
      label: field.label,
      level: "Lv3-1",
      domain: "status",
      valueText,
      valueNumber: parseNumber(valueText),
      unit: extractUnitFromValue(valueText),
      sourceFile: "STATUS.md",
      sourceType: "markdown",
      observedAt: normalizeCell(row["最終更新"]),
      personaTime: null,
      recordedAt: normalizeCell(row["最終更新"]),
      reason: normalizeCell(row["取得方法"]),
      metadata: {
        acquisition: normalizeCell(row["取得方法"]),
      },
    });
  }

  for (const row of firstTable(extractSection(text, "## Lv3-2 情緒・関係性（内省による可変データ）"))) {
    const item = normalizeCell(row["項目"]);
    if (!item) continue;

    const field = STATUS_EMOTION_FIELDS[item];
    if (!field) continue;

    const valueText = normalizeCell(row["値"]);

    metrics.push({
      key: field.key,
      label: field.label,
      level: "Lv3-2",
      domain: "status",
      valueText,
      valueNumber: parseNumber(valueText),
      unit: "score",
      sourceFile: "STATUS.md",
      sourceType: "markdown",
      observedAt: normalizeCell(row["最終更新"]),
      personaTime: null,
      recordedAt: normalizeCell(row["最終更新"]),
      reason: normalizeCell(row["根拠"]),
    });
  }

  for (const row of firstTable(extractSection(text, "## 変化履歴"))) {
    const field = resolveStatusHistoryField(row["項目"] ?? "");
    if (!field) continue;

    const previousValueText = normalizeCell(row["変化前"]);
    const nextValueText = normalizeCell(row["変化後"]);

    history.push({
      key: field.key,
      label: field.label,
      level: field.level,
      domain: field.domain,
      previousValueText,
      previousValueNumber: parseNumber(previousValueText),
      nextValueText,
      nextValueNumber: parseNumber(nextValueText),
      unit: field.level === "Lv3-2" ? "score" : extractUnitFromValue(nextValueText),
      changedAt: normalizeCell(row["日時"]),
      sourceFile: "STATUS.md",
      sourceType: "markdown",
      reason: normalizeCell(row["理由"]),
    });
  }

  return { metrics, history };
}

function replaceMarkdownCurrent(db: Database, metrics: PersonaMetric[]): void {
  db.query(
    "DELETE FROM persona_current WHERE source_file IN ('SOUL.md', 'BODY.md', 'STATUS.md', 'ENVIRONMENT.md')"
  ).run();

  const insert = db.query(
    `INSERT INTO persona_current (
      key, label, level, domain, value_text, value_number, unit, source_file, source_type,
      observed_at, persona_time, recorded_at, reason, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const metric of metrics) {
    insert.run(
      metric.key,
      metric.label,
      metric.level,
      metric.domain,
      metric.valueText,
      metric.valueNumber,
      metric.unit,
      metric.sourceFile,
      metric.sourceType,
      metric.observedAt,
      metric.personaTime,
      metric.recordedAt,
      metric.reason,
      toJson(metric.metadata),
    );
  }
}

function replaceMarkdownHistory(db: Database, entries: PersonaHistoryEntry[]): void {
  db.query(
    "DELETE FROM persona_history WHERE source_file IN ('BODY.md', 'STATUS.md', 'ENVIRONMENT.md')"
  ).run();

  const insert = db.query(
    `INSERT INTO persona_history (
      key, label, level, domain, previous_value_text, previous_value_number, next_value_text,
      next_value_number, unit, changed_at, source_file, source_type, reason, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const entry of entries) {
    insert.run(
      entry.key,
      entry.label,
      entry.level,
      entry.domain,
      entry.previousValueText,
      entry.previousValueNumber,
      entry.nextValueText,
      entry.nextValueNumber,
      entry.unit,
      entry.changedAt,
      entry.sourceFile,
      entry.sourceType,
      entry.reason,
      toJson(entry.metadata),
    );
  }
}

export function parseEnvironmentMarkdown(text: string): ParsedEnvironmentDocument {
  const parsed = parseEnvironmentDocument(text);
  const metrics: PersonaMetric[] = [];
  const history: PersonaHistoryEntry[] = [];

  for (const [key, entry] of Object.entries(parsed.current)) {
    if (!entry) continue;
    metrics.push({
      key,
      label: entry.label,
      level: "Lv0",
      domain: "environment",
      valueText: entry.rawValueText,
      valueNumber: entry.normalizedValue,
      unit: "score",
      sourceFile: "ENVIRONMENT.md",
      sourceType: "markdown",
      observedAt: entry.updatedAt,
      personaTime: null,
      recordedAt: entry.updatedAt,
      reason: entry.reason,
      metadata: {
        source: entry.source,
        statusTarget: ENVIRONMENT_FIELDS[key as keyof typeof ENVIRONMENT_FIELDS]?.statusTarget ?? null,
      },
    });
  }

  for (const [key, entry] of Object.entries(parsed.aux)) {
    if (!entry) continue;
    metrics.push({
      key,
      label: entry.label,
      level: "Lv0",
      domain: "environment",
      valueText: entry.valueText,
      valueNumber: parseNumber(entry.valueText),
      unit: key === "environment_thermal_baseline" ? "°C" : null,
      sourceFile: "ENVIRONMENT.md",
      sourceType: "markdown",
      observedAt: entry.updatedAt,
      personaTime: null,
      recordedAt: entry.updatedAt,
      reason: entry.note,
      metadata: {
        auxiliary: true,
      },
    });
  }

  for (const entry of parsed.history) {
    history.push({
      key: entry.key,
      label: entry.label,
      level: "Lv0",
      domain: "environment",
      previousValueText: entry.previousValueText,
      previousValueNumber: null,
      nextValueText: entry.nextValueText,
      nextValueNumber: entry.normalizedValue,
      unit: "score",
      changedAt: entry.changedAt,
      sourceFile: "ENVIRONMENT.md",
      sourceType: "markdown",
      reason: entry.reason,
      metadata: {
        source: parsed.current[entry.key]?.source ?? null,
        statusTarget: ENVIRONMENT_FIELDS[entry.key]?.statusTarget ?? null,
      },
    });
  }

  return { metrics, history };
}

function upsertMeta(db: Database, meta: PersonaMeta): void {
  const upsert = db.query(
    `INSERT INTO persona_meta (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  if (meta.name) {
    upsert.run("name", meta.name);
  }
  if (meta.firstPerson) {
    upsert.run("first_person", meta.firstPerson);
  }
}

async function seedCausalGraph(db: Database): Promise<void> {
  const seedText = await readPathOrNull(DEFAULT_CAUSAL_SEED_PATH);
  if (!seedText) return;

  const seed = JSON.parse(seedText) as { nodes?: CausalNode[]; edges?: CausalEdge[] };

  db.query("DELETE FROM causal_edges WHERE source_type = 'seed'").run();
  db.query("DELETE FROM causal_nodes WHERE source_type = 'seed'").run();

  const insertNode = db.query(
    `INSERT INTO causal_nodes (id, label, kind, data_level, description, source_type)
     VALUES (?, ?, ?, ?, ?, 'seed')`
  );
  const insertEdge = db.query(
    `INSERT INTO causal_edges (
      source_id, target_id, relation, causal_level, weight, description, source_type
    ) VALUES (?, ?, ?, ?, ?, ?, 'seed')`
  );

  for (const node of seed.nodes ?? []) {
    insertNode.run(node.id, node.label, node.kind, node.dataLevel, node.description ?? null);
  }

  for (const edge of seed.edges ?? []) {
    insertEdge.run(
      edge.source,
      edge.target,
      edge.relation,
      edge.causalLevel,
      edge.weight,
      edge.description ?? null,
    );
  }
}

export async function syncPersonaStructuredStore(): Promise<void> {
  const [soulText, bodyText, statusText, environmentText] = await Promise.all([
    readPathOrNull(DEFAULT_SOUL_PATH),
    readPathOrNull(DEFAULT_BODY_PATH),
    readPathOrNull(DEFAULT_STATUS_PATH),
    readPathOrNull(DEFAULT_ENVIRONMENT_PATH),
  ]);

  const db = openPersonaDb();

  try {
    const soul = soulText ? parseSoulDocument(soulText) : { meta: {}, metrics: [] };
    const body = bodyText ? parseBodyDocument(bodyText) : { metrics: [], history: [] };
    const status = statusText ? parseStatusDocument(statusText) : { metrics: [], history: [] };
    const environment = environmentText
      ? parseEnvironmentMarkdown(environmentText)
      : { metrics: [], history: [] };

    replaceMarkdownCurrent(db, [...soul.metrics, ...body.metrics, ...status.metrics, ...environment.metrics]);
    replaceMarkdownHistory(db, [...body.history, ...status.history, ...environment.history]);
    upsertMeta(db, soul.meta);
    await seedCausalGraph(db);
  } finally {
    db.close();
  }
}

export async function recordEnvironmentObservation(
  observation: EnvironmentObservationInput
): Promise<void> {
  const observedAt = observation.observedAt ? new Date(observation.observedAt) : new Date();

  if (observation.key === "environment_thermal_baseline") {
    await setEnvironmentAuxValue(
      "environment_thermal_baseline",
      observation.rawValue !== null ? `${observation.rawValue.toFixed(1)} °C` : null,
      {
        updatedAt: observedAt,
        note: observation.reason ?? "Core Max の EMA 基準値",
      }
    );
    await syncPersonaStructuredStore();
    return;
  }

  if (observation.key === "environment_sample_count") {
    await setEnvironmentAuxValue(
      "environment_sample_count",
      observation.rawValue !== null ? String(Math.round(observation.rawValue)) : null,
      {
        updatedAt: observedAt,
        note: observation.reason ?? "baseline 算出に使ったサンプル数",
      }
    );
    await syncPersonaStructuredStore();
    return;
  }

  if (!(observation.key in ENVIRONMENT_FIELDS)) {
    return;
  }

  let rawValueText: string | null = null;
  if (observation.key === "ambient_brightness" && observation.rawValue !== null) {
    rawValueText = `${Math.round(observation.rawValue)} / 255`;
  } else if (observation.rawValue !== null) {
    rawValueText = observation.unit ? `${observation.rawValue.toFixed(1)} ${observation.unit}` : String(observation.rawValue);
  }

  await setEnvironmentObservation(
    observation.key as keyof typeof ENVIRONMENT_FIELDS,
    rawValueText,
    observation.normalizedValue,
    {
      observedAt,
      source: observation.source ?? ENVIRONMENT_FIELDS[observation.key as keyof typeof ENVIRONMENT_FIELDS].sourceHint,
      reason: observation.reason ?? observation.label,
      recordHistoryOnUnchanged: true,
    }
  );
  await syncPersonaStructuredStore();
}

export async function readPersonaDashboardSnapshot(): Promise<{
  meta: Record<string, string>;
  current: DashboardMetricRow[];
  history: DashboardHistoryRow[];
  observations: EnvironmentObservationRow[];
  graph: { nodes: DashboardNodeRow[]; edges: DashboardEdgeRow[] };
}> {
  await syncPersonaStructuredStore();

  const db = openPersonaDb();

  try {
    const metaRows = db
      .query<DashboardMetaRow, []>("SELECT key, value FROM persona_meta ORDER BY key")
      .all();
    const current = db
      .query<DashboardMetricRow, []>(
        `SELECT key, label, level, domain, value_text AS valueText, value_number AS valueNumber,
                unit, source_file AS sourceFile, source_type AS sourceType,
                observed_at AS observedAt, persona_time AS personaTime, recorded_at AS recordedAt,
                reason, metadata_json AS metadataJson
         FROM persona_current`
      )
      .all();
    const history = db
      .query<DashboardHistoryRow, []>(
        `SELECT key, label, level, domain,
                previous_value_text AS previousValueText,
                previous_value_number AS previousValueNumber,
                next_value_text AS nextValueText,
                next_value_number AS nextValueNumber,
                unit,
                changed_at AS changedAt,
                source_file AS sourceFile,
                source_type AS sourceType,
                reason
         FROM persona_history
         ORDER BY COALESCE(changed_at, '') DESC
         LIMIT 300`
      )
      .all();
    const observations = db
      .query<EnvironmentObservationRow, []>(
        `SELECT id,
                key,
                label,
                source_file AS source,
                source_type AS sourceType,
                changed_at AS observedAt,
                next_value_text AS rawValueText,
                next_value_number AS normalizedValue,
                reason
         FROM persona_history
         WHERE source_file = 'ENVIRONMENT.md'
         ORDER BY COALESCE(changed_at, '') DESC
         LIMIT 120`
      )
      .all();
    const nodes = db
      .query<DashboardNodeRow, []>(
        `SELECT id, label, kind, data_level AS dataLevel, description
         FROM causal_nodes
         ORDER BY kind, id`
      )
      .all();
    const edges = db
      .query<DashboardEdgeRow, []>(
        `SELECT source_id AS sourceId, target_id AS targetId, relation,
                causal_level AS causalLevel, weight, description
         FROM causal_edges
         ORDER BY causal_level, source_id, target_id`
      )
      .all();

    return {
      meta: Object.fromEntries(metaRows.map((row) => [row.key, row.value])),
      current,
      history,
      observations,
      graph: { nodes, edges },
    };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  await syncPersonaStructuredStore();
  console.log(`[persona-data] synced ${PERSONA_DB_PATH}`);
}
