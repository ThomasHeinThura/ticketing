import { csvRow, isoDay, minutesToHours } from "./logic";
import type {
  Cell,
  Chart,
  Column,
  Metric,
  ReportCategory,
  ReportChoice,
  ReportFilters,
  Row,
} from "./types";

export type ReportEnvelope = {
  key: string;
  title: string;
  category: ReportCategory;
  tier: 1;
  /** RP-3: whose numbers these are. `all` is every project of the workspace; `reach` the caller's own. */
  scope: { kind: "all" | "reach"; projectCount: number };
  /** RP-4: the window, or `live` for a report that is always now. */
  window: {
    preset: string;
    from: string;
    to: string;
    days: number;
    live: boolean;
  };
  asOf: string;
  /**
   * RP-9: where the numbers came from. `snapshot` is closed days only, `live` is computed now, and
   * `mixed` is stored closed days plus a live current day (or a day the job has not stored yet).
   */
  boundary: "live" | "snapshot" | "mixed";
  /** RP-9: the stored part, stated: how many closed days, how many were missing, and from when. */
  snapshot: {
    closedDays: number;
    uncoveredDays: number;
    computedAt: string | null;
    /** The end of the last stored day: everything after it is computed live. */
    through: string | null;
  } | null;
  filters: ReportFilters;
  options: Record<string, string>;
  choices: ReportChoice[];
  metrics: Metric[];
  chart: Chart | null;
  columns: Column[];
  rows: Row[];
  truncated: boolean;
  /** RP-5: set when the population is empty; the screen shows "—" and this explanation. */
  empty: {
    reason: "no_data_in_window" | "no_data";
    outsideWindow: number;
    excluded: { count: number; reason: string } | null;
  } | null;
  excluded: { count: number; reason: string } | null;
  notes: string[];
  drill: boolean;
  /** TC-11: false when the caller may not see rates, and every rate-derived field is absent. */
  costVisible: boolean;
};

/**
 * TC-11: one function every surface calls (report detail, widget data, preview, CSV). Columns,
 * metrics and series marked `sensitive` are removed, not blanked, unless the caller may see rates.
 * The report itself already avoids selecting rate data for such a caller; this is the backstop.
 */
export function stripRates(
  envelope: ReportEnvelope,
  showRates: boolean,
): ReportEnvelope {
  if (showRates) return { ...envelope, costVisible: true };
  const hidden = new Set(
    envelope.columns.filter((column) => column.sensitive).map((c) => c.key),
  );
  return {
    ...envelope,
    costVisible: false,
    columns: envelope.columns.filter((column) => !column.sensitive),
    rows: envelope.rows.map((row) => {
      const copy: Row = {};
      for (const [key, value] of Object.entries(row))
        if (!hidden.has(key)) copy[key] = value;
      return copy;
    }),
    metrics: envelope.metrics.filter((metric) => !metric.sensitive),
    chart: envelope.chart
      ? {
          ...envelope.chart,
          series: envelope.chart.series.filter((series) => !series.sensitive),
        }
      : null,
  };
}

function cellText(value: Cell | undefined): string | number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "object")
    return `not enough data (${value.n} of ${value.needed})`;
  return value;
}

/**
 * RP-10: the report as CSV, as shown: the same filters, the viewer's reach and no rate data for a
 * caller who may not see it. A short preamble states scope, window and as-of time (RP-3, RP-4).
 */
export function reportToCsv(envelope: ReportEnvelope): string {
  const lines = [
    csvRow([`# ${envelope.title}`]),
    csvRow([
      `# Scope: ${envelope.scope.kind === "all" ? "all projects" : "your projects"} (${envelope.scope.projectCount})`,
    ]),
    csvRow([
      envelope.window.live
        ? "# Window: live"
        : `# Window: ${isoDay(new Date(envelope.window.from))} to ${isoDay(new Date(envelope.window.to))}`,
    ]),
    csvRow([`# As of: ${envelope.asOf}`]),
  ];
  // RP-9: the same boundary the screen states.
  if (envelope.snapshot)
    lines.push(
      csvRow([
        `# Source: ${envelope.snapshot.closedDays} closed day(s) from stored daily snapshots${
          envelope.snapshot.through
            ? ` up to ${envelope.snapshot.through.slice(0, 10)}`
            : ""
        }${envelope.boundary === "mixed" ? "; the rest is computed live" : ""}`,
      ]),
    );
  // RP-10: a report cut at its row cap says so; a cap that silently drops rows is a lie by omission.
  if (envelope.truncated)
    lines.push(
      csvRow([
        `# Truncated: this report stops at ${envelope.rows.length} rows; narrow the filters for the rest`,
      ]),
    );
  lines.push(csvRow(envelope.columns.map((column) => column.label)));
  for (const row of envelope.rows)
    lines.push(
      csvRow(envelope.columns.map((column) => cellText(row[column.key]))),
    );
  return `${lines.join("\r\n")}\r\n`;
}

export { minutesToHours };
