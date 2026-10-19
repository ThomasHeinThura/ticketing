import type { WorkItemSearchQuery } from "./query";

export const DEFAULT_EXPORT_COLUMNS = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;

export const EXPORT_MAX_ROWS = 10_000;
export const EXPORT_QUERY_TIMEOUT_MS = 30_000;
export const EXPORT_RATE_LIMIT_MAX = 5;
export const EXPORT_RATE_LIMIT_WINDOW_MS = 60_000;

const exportRateLimitBuckets = new Map<string, number[]>();

export function checkAndRecordExportRateLimit(
  userId: string,
  nowMs: number = Date.now(),
): boolean {
  const windowStart = nowMs - EXPORT_RATE_LIMIT_WINDOW_MS;
  const previous = exportRateLimitBuckets.get(userId) ?? [];
  const active = previous.filter((ts) => ts > windowStart);
  if (active.length >= EXPORT_RATE_LIMIT_MAX) {
    exportRateLimitBuckets.set(userId, active);
    return false;
  }
  active.push(nowMs);
  exportRateLimitBuckets.set(userId, active);
  return true;
}

export function resetWorkItemExportRateLimitsForTest() {
  exportRateLimitBuckets.clear();
}

export async function collectExportPages<T>(
  fetchPage: (cursor?: string) => Promise<{
    data: T[];
    page: { hasMore: boolean; nextCursor: string | null };
    meta: { total: number };
  }>,
): Promise<{ rows: T[]; total: number }> {
  const rows: T[] = [];
  let cursor: string | undefined;
  let total = 0;
  do {
    const page = await fetchPage(cursor);
    rows.push(...page.data);
    total = page.meta.total;
    cursor = page.page.hasMore
      ? (page.page.nextCursor ?? undefined)
      : undefined;
    if (page.page.hasMore && !cursor)
      throw new Error("Export pagination ended without a cursor");
  } while (cursor);
  return { rows, total };
}

export type ExportRow = {
  key: string;
  title: string;
  stateName: string | null;
  assigneeName: string | null;
  priority: string | null;
  dueDate: string | null;
};

export function exportColumns(query: WorkItemSearchQuery) {
  return query.columns ?? [...DEFAULT_EXPORT_COLUMNS];
}

function safeCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  // Spreadsheet programs may evaluate cells beginning with a formula marker,
  // including when whitespace precedes it. Prefix those cells with text data.
  if (/^[\s\p{Cc}]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const HEADINGS: Record<string, string> = {
  key: "Key",
  title: "Title",
  state: "State",
  assignee: "Assignee",
  priority: "Priority",
  dueDate: "Due date",
};

const VALUES: Record<string, (row: ExportRow) => unknown> = {
  key: (row) => row.key,
  title: (row) => row.title,
  state: (row) => row.stateName,
  assignee: (row) => row.assigneeName,
  priority: (row) => row.priority,
  dueDate: (row) => row.dueDate,
};

export function workItemsCsvHeader(columns: readonly string[]): string {
  return `${columns.map((column) => safeCell(HEADINGS[column])).join(",")}\r\n`;
}

export function workItemsCsvRows(
  rows: ExportRow[],
  columns: readonly string[],
): string {
  if (rows.length === 0) return "";
  return `${rows
    .map((row) =>
      columns.map((column) => safeCell(VALUES[column]?.(row))).join(","),
    )
    .join("\r\n")}\r\n`;
}

export function workItemsCsv(rows: ExportRow[], columns: readonly string[]) {
  return `${workItemsCsvHeader(columns)}${workItemsCsvRows(rows, columns)}`;
}
