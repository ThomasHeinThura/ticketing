import type { AuditRowResponse } from "./response";

/** Column order of the CSV export; one stable header, never derived from row content. */
export const AUDIT_EXPORT_COLUMNS = [
  "seq",
  "createdAt",
  "actorId",
  "actorType",
  "impersonatorId",
  "workspaceId",
  "organisationId",
  "action",
  "entityType",
  "entityId",
  "before",
  "after",
] as const;

/**
 * One CSV field. Quotes when it carries a delimiter, quote or line break, and neutralises
 * spreadsheet formula injection: a field starting with `=`, `+`, `-`, `@`, tab or CR is
 * prefixed with an apostrophe so a spreadsheet shows it as text (audit values such as
 * entity ids and JSON payloads are user-influenced).
 */
export function csvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function cell(
  row: AuditRowResponse,
  column: (typeof AUDIT_EXPORT_COLUMNS)[number],
) {
  if (column === "before" || column === "after") {
    const value = row[column];
    return value === null || value === undefined ? "" : JSON.stringify(value);
  }
  return row[column];
}

export function auditRowsToCsv(rows: readonly AuditRowResponse[]): string {
  const lines = [AUDIT_EXPORT_COLUMNS.join(",")];
  for (const row of rows)
    lines.push(
      AUDIT_EXPORT_COLUMNS.map((column) => csvField(cell(row, column))).join(
        ",",
      ),
    );
  return `${lines.join("\r\n")}\r\n`;
}

export function auditRowsToJson(rows: readonly AuditRowResponse[]): string {
  return JSON.stringify({ rows }, null, 2);
}
