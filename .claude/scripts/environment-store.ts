import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SCRIPT_DIR = import.meta.dir;
const PROJECT_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_ENVIRONMENT_PATH = resolve(PROJECT_ROOT, "ENVIRONMENT.md");
const DEFAULT_ENVIRONMENT_TEMPLATE_PATH = resolve(PROJECT_ROOT, ".claude/templates/ENVIRONMENT.template.md");

const CURRENT_SECTION_HEADING = "## 現在の環境";
const AUX_SECTION_HEADING = "## 補助状態";
const HISTORY_SECTION_HEADING = "## 変化履歴";
const HISTORY_ENTRY_RE = /^\| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \|/;
const AUX_HEADERS = ["項目", "値", "最終更新", "備考"];
const AUX_SEPARATOR = "|---|---|---|---|";
const HISTORY_HEADERS = ["日時", "項目", "変化前", "変化後", "正規化値", "理由"];
const HISTORY_SEPARATOR = "|---|---|---|---|---|---|";

export const ENVIRONMENT_FIELDS = {
  environment_thermal_load: {
    label: "環境熱負荷 proxy",
    sourceHint: "LHM/Core Max",
    statusTarget: "energy",
  },
  ambient_brightness: {
    label: "環境光",
    sourceHint: "wifi-cam RTSP brightness",
    statusTarget: "mood",
  },
  ambient_temperature: {
    label: "気温",
    sourceHint: "JMA/AMeDAS",
    statusTarget: "health",
  },
  ambient_humidity: {
    label: "湿度",
    sourceHint: "JMA/AMeDAS",
    statusTarget: null,
  },
} as const;

export const ENVIRONMENT_AUX_FIELDS = {
  environment_thermal_baseline: {
    label: "熱負荷 baseline",
    noteHint: "Core Max の EMA 基準値",
  },
  environment_sample_count: {
    label: "観測サンプル数",
    noteHint: "baseline 算出に使ったサンプル数",
  },
  environment_brightness_baseline: {
    label: "環境光 baseline",
    noteHint: "ROI 輝度の slow EMA 基準値（相対評価用）",
  },
  environment_brightness_sample_count: {
    label: "環境光観測サンプル数",
    noteHint: "baseline 算出に使ったサンプル数",
  },
  environment_brightness_roi: {
    label: "環境光 ROI",
    noteHint: "normalized x,y,w,h",
  },
} as const;

export type EnvironmentField = keyof typeof ENVIRONMENT_FIELDS;
export type EnvironmentAuxField = keyof typeof ENVIRONMENT_AUX_FIELDS;

export interface EnvironmentObservationEntry {
  key: EnvironmentField;
  label: string;
  rawValueText: string | null;
  normalizedValue: number | null;
  updatedAt: string | null;
  source: string | null;
  reason: string | null;
}

export interface EnvironmentAuxEntry {
  key: EnvironmentAuxField;
  label: string;
  valueText: string | null;
  updatedAt: string | null;
  note: string | null;
}

export interface EnvironmentHistoryEntry {
  key: EnvironmentField;
  label: string;
  previousValueText: string | null;
  nextValueText: string | null;
  normalizedValue: number | null;
  changedAt: string | null;
  reason: string | null;
}

export interface ParsedEnvironmentDocument {
  current: Partial<Record<EnvironmentField, EnvironmentObservationEntry>>;
  aux: Partial<Record<EnvironmentAuxField, EnvironmentAuxEntry>>;
  history: EnvironmentHistoryEntry[];
}

interface SetEnvironmentObservationOptions {
  observedAt?: Date;
  source?: string;
  reason: string;
  environmentPath?: string;
  recordHistoryOnUnchanged?: boolean;
}

interface SetEnvironmentAuxValueOptions {
  updatedAt?: Date;
  note?: string | null;
  environmentPath?: string;
}

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

  const currentLevel = heading.match(/^(#+)\s/)?.[1].length ?? 2;
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
  for (const block of extractTableBlocks(sectionText)) {
    if (block.length < 2) continue;
    return parseMarkdownTable(block);
  }
  return [];
}

function findCurrentFieldByLabel(label: string | null): EnvironmentField | null {
  if (!label) return null;
  for (const [key, config] of Object.entries(ENVIRONMENT_FIELDS) as [EnvironmentField, { label: string }][]) {
    if (config.label === label) return key;
  }
  return null;
}

function findAuxFieldByLabel(label: string | null): EnvironmentAuxField | null {
  if (!label) return null;
  for (const [key, config] of Object.entries(ENVIRONMENT_AUX_FIELDS) as [EnvironmentAuxField, { label: string }][]) {
    if (config.label === label) return key;
  }
  return null;
}

export function resolveEnvironmentPath(explicitPath?: string): string {
  return explicitPath ?? process.env.WARDROBE_ENVIRONMENT_PATH?.trim() ?? DEFAULT_ENVIRONMENT_PATH;
}

export function formatEnvironmentTimestamp(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

async function ensureEnvironmentDocument(environmentPath: string): Promise<void> {
  const file = Bun.file(environmentPath);
  if (await file.exists()) return;

  mkdirSync(dirname(environmentPath), { recursive: true });
  const template = Bun.file(DEFAULT_ENVIRONMENT_TEMPLATE_PATH);
  if (await template.exists()) {
    await Bun.write(environmentPath, await template.text());
    return;
  }

  await Bun.write(
    environmentPath,
    `# ENVIRONMENT.md — 環境データ\n\n${CURRENT_SECTION_HEADING}\n\n${AUX_SECTION_HEADING}\n\n${HISTORY_SECTION_HEADING}\n`
  );
}

function findFieldLineIndex(lines: string[], label: string): number {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\| ${escapedLabel} \\|`);
  return lines.findIndex((line) => pattern.test(line));
}

function findHistoryInsertionIndex(lines: string[]): number {
  const historyHeaderIndex = lines.findIndex((line) => line.trim() === HISTORY_SECTION_HEADING);
  if (historyHeaderIndex === -1) return lines.length;

  for (let index = historyHeaderIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    const nextHeading = line.match(/^(#+)\s/);
    if (nextHeading) break;

    if (line.startsWith("|")) {
      const cells = parsePipeRow(line);
      if (cells.length === HISTORY_HEADERS.length && cells.every((cell, cellIndex) => cell === HISTORY_HEADERS[cellIndex])) {
        if (index + 1 >= lines.length || lines[index + 1].trim() !== HISTORY_SEPARATOR) {
          lines.splice(index + 1, 0, HISTORY_SEPARATOR);
        }
        return index + 2;
      }
    }
  }

  const insertIndex = historyHeaderIndex + 1;
  lines.splice(insertIndex, 0, `| ${HISTORY_HEADERS.join(" | ")} |`, HISTORY_SEPARATOR);
  return insertIndex + 2;
}

function findAuxInsertionIndex(lines: string[]): number {
  const auxHeaderIndex = lines.findIndex((line) => line.trim() === AUX_SECTION_HEADING);
  if (auxHeaderIndex === -1) return lines.length;

  for (let index = auxHeaderIndex + 1; index < lines.length; index++) {
    const line = lines[index].trim();
    const nextHeading = line.match(/^(#+)\s/);
    if (nextHeading) {
      lines.splice(index, 0, `| ${AUX_HEADERS.join(" | ")} |`, AUX_SEPARATOR);
      return index + 2;
    }

    if (line.startsWith("|")) {
      const cells = parsePipeRow(line);
      if (cells.length === AUX_HEADERS.length && cells.every((cell, cellIndex) => cell === AUX_HEADERS[cellIndex])) {
        if (index + 1 >= lines.length || lines[index + 1].trim() !== AUX_SEPARATOR) {
          lines.splice(index + 1, 0, AUX_SEPARATOR);
        }

        let insertIndex = index + 2;
        while (insertIndex < lines.length && lines[insertIndex].trim().startsWith("|")) {
          insertIndex += 1;
        }
        return insertIndex;
      }
    }
  }

  const insertIndex = auxHeaderIndex + 1;
  lines.splice(insertIndex, 0, `| ${AUX_HEADERS.join(" | ")} |`, AUX_SEPARATOR);
  return insertIndex + 2;
}

function parseHistoryEntries(sectionText: string): EnvironmentHistoryEntry[] {
  const history: EnvironmentHistoryEntry[] = [];

  for (const rawLine of sectionText.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;

    const cells = parsePipeRow(line);
    if (cells.length < HISTORY_HEADERS.length) continue;
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(cells[0] ?? "")) continue;

    const key = findCurrentFieldByLabel(normalizeCell(cells[1]));
    if (!key) continue;

    history.push({
      key,
      label: ENVIRONMENT_FIELDS[key].label,
      previousValueText: normalizeCell(cells[2]),
      nextValueText: normalizeCell(cells[3]),
      normalizedValue: parseNumber(normalizeCell(cells[4])),
      changedAt: normalizeCell(cells[0]),
      reason: normalizeCell(cells[5]),
    });
  }

  return history;
}

export function parseEnvironmentDocument(text: string): ParsedEnvironmentDocument {
  const current: Partial<Record<EnvironmentField, EnvironmentObservationEntry>> = {};
  const aux: Partial<Record<EnvironmentAuxField, EnvironmentAuxEntry>> = {};
  const history: EnvironmentHistoryEntry[] = [];

  for (const row of firstTable(extractSection(text, CURRENT_SECTION_HEADING))) {
    const key = findCurrentFieldByLabel(normalizeCell(row["項目"]));
    if (!key) continue;

    current[key] = {
      key,
      label: ENVIRONMENT_FIELDS[key].label,
      rawValueText: normalizeCell(row["生値"]),
      normalizedValue: parseNumber(normalizeCell(row["正規化値"])),
      updatedAt: normalizeCell(row["最終更新"]),
      source: normalizeCell(row["取得方法"]),
      reason: normalizeCell(row["根拠"]),
    };
  }

  for (const row of firstTable(extractSection(text, AUX_SECTION_HEADING))) {
    const key = findAuxFieldByLabel(normalizeCell(row["項目"]));
    if (!key) continue;

    aux[key] = {
      key,
      label: ENVIRONMENT_AUX_FIELDS[key].label,
      valueText: normalizeCell(row["値"]),
      updatedAt: normalizeCell(row["最終更新"]),
      note: normalizeCell(row["備考"]),
    };
  }

  history.push(...parseHistoryEntries(extractSection(text, HISTORY_SECTION_HEADING)));

  return { current, aux, history };
}

export async function readEnvironmentDocument(environmentPath?: string): Promise<ParsedEnvironmentDocument | null> {
  const resolvedPath = resolveEnvironmentPath(environmentPath);
  const file = Bun.file(resolvedPath);
  if (!(await file.exists())) return null;
  return parseEnvironmentDocument(await file.text());
}

export async function setEnvironmentObservation(
  field: EnvironmentField,
  rawValueText: string | null,
  normalizedValue: number | null,
  options: SetEnvironmentObservationOptions
): Promise<void> {
  const environmentPath = resolveEnvironmentPath(options.environmentPath);
  await ensureEnvironmentDocument(environmentPath);

  const file = Bun.file(environmentPath);
  const text = await file.text();
  const lines = text.split("\n");
  const parsed = parseEnvironmentDocument(text);
  const current = parsed.current[field];
  const label = ENVIRONMENT_FIELDS[field].label;
  const rowIndex = findFieldLineIndex(lines, label);
  if (rowIndex === -1) return;

  const observedAt = formatEnvironmentTimestamp(options.observedAt ?? new Date());
  const currentRaw = current?.rawValueText ?? null;
  const changed = currentRaw !== rawValueText || current?.normalizedValue !== normalizedValue || current?.reason !== options.reason;

  lines[rowIndex] =
    `| ${label} | ${rawValueText ?? "—"} | ${normalizedValue ?? "—"} | ${observedAt} | ` +
    `${options.source ?? ENVIRONMENT_FIELDS[field].sourceHint} | ${options.reason} |`;

  if (changed || options.recordHistoryOnUnchanged) {
    const historyEntry =
      `| ${observedAt} | ${label} | ${currentRaw ?? "—"} | ${rawValueText ?? "—"} | ` +
      `${normalizedValue ?? "—"} | ${options.reason} |`;
    const insertIndex = findHistoryInsertionIndex(lines);
    lines.splice(insertIndex, 0, historyEntry);
  }

  const output = lines.join("\n");
  await Bun.write(environmentPath, text.endsWith("\n") && !output.endsWith("\n") ? `${output}\n` : output);
}

export async function setEnvironmentAuxValue(
  field: EnvironmentAuxField,
  valueText: string | null,
  options: SetEnvironmentAuxValueOptions
): Promise<void> {
  const environmentPath = resolveEnvironmentPath(options.environmentPath);
  await ensureEnvironmentDocument(environmentPath);

  const file = Bun.file(environmentPath);
  const text = await file.text();
  const lines = text.split("\n");
  const label = ENVIRONMENT_AUX_FIELDS[field].label;
  let rowIndex = findFieldLineIndex(lines, label);
  if (rowIndex === -1) {
    const insertIndex = findAuxInsertionIndex(lines);
    lines.splice(insertIndex, 0, `| ${label} | — | — | ${ENVIRONMENT_AUX_FIELDS[field].noteHint} |`);
    rowIndex = insertIndex;
  }

  const updatedAt = formatEnvironmentTimestamp(options.updatedAt ?? new Date());
  lines[rowIndex] = `| ${label} | ${valueText ?? "—"} | ${updatedAt} | ${options.note ?? ENVIRONMENT_AUX_FIELDS[field].noteHint} |`;

  const output = lines.join("\n");
  await Bun.write(environmentPath, text.endsWith("\n") && !output.endsWith("\n") ? `${output}\n` : output);
}
