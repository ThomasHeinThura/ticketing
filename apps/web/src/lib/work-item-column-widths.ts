import type { WorkItemSearchColumn } from "./work-item-list-search";
import { isWorkItemSearchColumn } from "./work-item-list-search";

export type TableColumnWidths = Partial<Record<WorkItemSearchColumn, number>>;

/** VW-21: the same registered-column and size domain enforced by the settings API. */
export function parseTableColumnWidths(
  raw: unknown,
): TableColumnWidths | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return undefined;
  const entries = Object.entries(raw);
  if (entries.length > 100) return undefined;
  for (const [column, width] of entries) {
    if (
      !isWorkItemSearchColumn(column) ||
      typeof width !== "number" ||
      !Number.isInteger(width) ||
      width < 64 ||
      width > 800
    )
      return undefined;
  }
  return raw as TableColumnWidths;
}
