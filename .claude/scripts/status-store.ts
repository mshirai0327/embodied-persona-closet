const DEFAULT_STATUS_PATH = `${import.meta.dir}/../../STATUS.md`;

export const STATUS_LABELS = {
  mood: "mood（気分）",
  energy: "energy（活力）",
  health: "health（健康感）",
  trust_mizuho: "trust_mizuho（信頼）",
  satiation: "satiation（充足感）",
} as const;

export type StatusField = keyof typeof STATUS_LABELS;

export interface StatusEntry {
  field: StatusField;
  label: string;
  value: number;
  updatedAt: string;
  reason: string;
}

export type StatusSnapshot = Partial<Record<StatusField, StatusEntry>>;

export interface StatusUpdateResult {
  field: StatusField;
  previousValue: number;
  nextValue: number;
  changed: boolean;
  statusPath: string;
}

interface SetStatusValueOptions {
  now?: Date;
  reason: string;
  recordHistoryOnUnchanged?: boolean;
  statusPath?: string;
  updateTimestampOnUnchanged?: boolean;
}

const HISTORY_ENTRY_RE = /^\| \d{4}-\d{2}-\d{2} \d{2}:\d{2} \|/;

function normalizeStatusValue(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function resolveStatusPath(explicitPath?: string): string {
  return explicitPath ?? process.env.WARDROBE_STATUS_PATH?.trim() ?? DEFAULT_STATUS_PATH;
}

export function formatStatusTimestamp(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace("T", " ");
}

export function parseStatusSnapshot(text: string): StatusSnapshot {
  const snapshot: StatusSnapshot = {};

  for (const [field, label] of Object.entries(STATUS_LABELS) as [StatusField, string][]) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `^\\| ${escapedLabel} \\| (\\d+) \\| (\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}) \\| (.+) \\|$`
    );

    for (const line of text.split("\n")) {
      const match = line.match(pattern);
      if (!match) continue;

      snapshot[field] = {
        field,
        label,
        value: parseInt(match[1], 10),
        updatedAt: match[2],
        reason: match[3],
      };
      break;
    }
  }

  return snapshot;
}

export async function readStatusSnapshot(statusPath?: string): Promise<StatusSnapshot | null> {
  const resolvedStatusPath = resolveStatusPath(statusPath);
  const file = Bun.file(resolvedStatusPath);
  if (!(await file.exists())) return null;
  return parseStatusSnapshot(await file.text());
}

function findFieldLineIndex(lines: string[], label: string): number {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\| ${escapedLabel} \\|`);
  return lines.findIndex((line) => pattern.test(line));
}

function findHistoryInsertionIndex(lines: string[]): number {
  const firstHistoryEntryIndex = lines.findIndex((line) => HISTORY_ENTRY_RE.test(line));
  if (firstHistoryEntryIndex !== -1) {
    return firstHistoryEntryIndex;
  }

  const historyHeaderIndex = lines.findIndex((line) => line.trim() === "## 変化履歴");
  if (historyHeaderIndex === -1) {
    return lines.length;
  }

  for (let i = historyHeaderIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith("|")) {
      continue;
    }
    return i;
  }

  return lines.length;
}

export async function setStatusValue(
  field: StatusField,
  nextValue: number,
  options: SetStatusValueOptions
): Promise<StatusUpdateResult | null> {
  const statusPath = resolveStatusPath(options.statusPath);
  const file = Bun.file(statusPath);
  if (!(await file.exists())) return null;

  const text = await file.text();
  const lines = text.split("\n");
  const label = STATUS_LABELS[field];
  const rowIndex = findFieldLineIndex(lines, label);
  if (rowIndex === -1) return null;

  const snapshot = parseStatusSnapshot(text);
  const currentEntry = snapshot[field];
  if (!currentEntry) return null;

  const normalizedNextValue = normalizeStatusValue(nextValue);
  const changed = normalizedNextValue !== currentEntry.value;
  const shouldWrite = changed || options.updateTimestampOnUnchanged;
  if (!shouldWrite) {
    return {
      field,
      previousValue: currentEntry.value,
      nextValue: normalizedNextValue,
      changed,
      statusPath,
    };
  }

  const now = options.now ?? new Date();
  const nowStr = formatStatusTimestamp(now);
  lines[rowIndex] = `| ${label} | ${normalizedNextValue} | ${nowStr} | ${options.reason} |`;

  if (changed || options.recordHistoryOnUnchanged) {
    const historyEntry = `| ${nowStr} | ${field} | ${currentEntry.value} | ${normalizedNextValue} | ${options.reason} |`;
    const insertIndex = findHistoryInsertionIndex(lines);
    lines.splice(insertIndex, 0, historyEntry);
  }

  const output = lines.join("\n");
  await Bun.write(statusPath, text.endsWith("\n") && !output.endsWith("\n") ? `${output}\n` : output);

  return {
    field,
    previousValue: currentEntry.value,
    nextValue: normalizedNextValue,
    changed,
    statusPath,
  };
}

export async function adjustStatusValue(
  field: StatusField,
  delta: number,
  options: Omit<SetStatusValueOptions, "reason"> & { reason: string }
): Promise<StatusUpdateResult | null> {
  const snapshot = await readStatusSnapshot(options.statusPath);
  const currentEntry = snapshot?.[field];
  if (!currentEntry) return null;

  return setStatusValue(field, currentEntry.value + delta, options);
}
