import type { WorkItemSearchQuery } from "./query";

export const DEFAULT_EXPORT_COLUMNS = [
  "key",
  "title",
  "state",
  "assignee",
  "priority",
  "dueDate",
] as const;

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

type ExportRow = {
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

export function workItemsCsv(rows: ExportRow[], columns: readonly string[]) {
  const headings: Record<string, string> = {
    key: "Key",
    title: "Title",
    state: "State",
    assignee: "Assignee",
    priority: "Priority",
    dueDate: "Due date",
  };
  const values: Record<string, (row: ExportRow) => unknown> = {
    key: (row) => row.key,
    title: (row) => row.title,
    state: (row) => row.stateName,
    assignee: (row) => row.assigneeName,
    priority: (row) => row.priority,
    dueDate: (row) => row.dueDate,
  };
  return `${[
    columns.map((column) => safeCell(headings[column])).join(","),
    ...rows.map((row) =>
      columns.map((column) => safeCell(values[column]?.(row))).join(","),
    ),
  ].join("\r\n")}\r\n`;
}
