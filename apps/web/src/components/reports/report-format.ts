import type { TFunction } from "i18next";
import type { ReportCell, ReportColumn, ReportMetric } from "@/fetchers/report";
import { formatDate, formatDateTime } from "@/lib/format";

/** `RP-1`: a cell the API could not compute is `{ n, needed }`, shown as the reason, never a number. */
export function isInsufficient(
  cell: ReportCell | undefined,
): cell is { n: number; needed: number } {
  return typeof cell === "object" && cell !== null;
}

export function formatMoney(minor: number, currency: string, locale?: string) {
  try {
    const format = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    return format.format(minor / 10 ** digits);
  } catch {
    return `${currency} ${minor}`;
  }
}

export function formatValue(
  value: number,
  unit: ReportMetric["unit"],
  currency?: string,
): string {
  if (unit === "percent") return `${value}%`;
  if (unit === "hours") return `${Number(value.toFixed(2))} h`;
  if (unit === "days") return `${value} d`;
  if (unit === "money" && currency) return formatMoney(value, currency);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The text of a metric: its value, or "Not enough data (n of m)" (`RP-1`). */
export function metricText(metric: ReportMetric, t: TFunction): string {
  if (metric.value === null)
    return t("reports:notEnoughData", { n: metric.n, needed: metric.needed });
  return formatValue(metric.value, metric.unit, metric.currency);
}

export function cellText(
  cell: ReportCell | undefined,
  column: ReportColumn,
  row: Record<string, ReportCell>,
  t: TFunction,
): string {
  if (isInsufficient(cell))
    return t("reports:notEnoughData", { n: cell.n, needed: cell.needed });
  if (cell === null || cell === undefined || cell === "") return "—";
  if (column.key === "group" && row._drill === "epic-none")
    return t("reports:groups.noEpic", { defaultValue: "No epic" });
  if (column.key === "group" && row._drill === "epic-unavailable")
    return t("reports:groups.epicUnavailable", {
      defaultValue: "Epic unavailable",
    });
  if (column.key === "inactive" && cell === "Inactive")
    return t("reports:values.inactive", { defaultValue: "Inactive" });
  if (typeof cell === "number") {
    if (column.kind === "money") {
      const currency = row.currency;
      return typeof currency === "string"
        ? formatMoney(cell, currency)
        : String(cell);
    }
    const unit =
      column.kind === "percent" ||
      column.kind === "hours" ||
      column.kind === "days"
        ? column.kind
        : "count";
    return formatValue(cell, unit);
  }
  if (column.kind === "date") {
    const parsed = new Date(cell);
    if (!Number.isNaN(parsed.getTime()))
      return cell.length > 10
        ? formatDateTime(parsed)
        : formatDate(parsed, {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "UTC",
          });
  }
  return cell;
}

/** A header the screen words itself, falling back to the API's English label. */
export function columnLabel(column: ReportColumn, t: TFunction): string {
  const key =
    column.key === "value" && column.label === "Matching work items"
      ? "reports:columns.matchingWorkItems"
      : `reports:columns.${column.key}`;
  return t(key, { defaultValue: column.label });
}
