import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { SQL } from "drizzle-orm";
import type { ReportWindow, Sampled, Trend } from "./logic";
import type { SnapshotUse } from "./snapshot.logic";

/**
 * A table cell. `{ n, needed }` is the honesty rule's "not enough data (n of needed)" (RP-1): a
 * rate whose sample is too small is never written as 0% or 100%. Plain `null` is "not applicable".
 */
export type Cell = string | number | null | { n: number; needed: number };

export type ColumnKind =
  | "text"
  | "number"
  | "percent"
  | "hours"
  | "days"
  | "date"
  | "money"
  | "bucket";

export type Column = {
  key: string;
  /** English header used by CSV and as the web fallback; the web translates by `key`. */
  label: string;
  kind: ColumnKind;
  /** Rate and cost data (TC-11): removed from every surface unless the caller may see rates. */
  sensitive?: boolean;
};

export type MetricUnit =
  | "percent"
  | "count"
  | "hours"
  | "days"
  | "score"
  | "money";

export type Metric = {
  key: string;
  label: string;
  unit: MetricUnit;
  value: number | null;
  n: number;
  needed: number;
  trend?: Trend;
  currency?: string;
  sensitive?: boolean;
};

export type ChartSeries = {
  key: string;
  label: string;
  values: Array<number | null>;
  sensitive?: boolean;
};

export type Chart = {
  type: "bar" | "line";
  unit: MetricUnit;
  categories: string[];
  series: ChartSeries[];
};

export type Row = Record<string, Cell> & {
  /** Drill-down handle (RP-12): the bucket or group this row stands for. */
  _drill?: string;
};

export type ReportCategory =
  | "promises"
  | "customers"
  | "delivery"
  | "people"
  | "leadership"
  | "agile"
  | "time"
  | "knowledge";

export type ReportFilters = {
  projectId?: string;
  organisationId?: string;
  teamId?: string;
  typeId?: string;
  priority?: string;
};

export const FILTER_KEYS = [
  "projectId",
  "organisationId",
  "teamId",
  "typeId",
  "priority",
] as const;

export type ReportContext = {
  workspaceId: string;
  identity: ResolvedIdentity;
  /** `report:read_all`: every project of this workspace (and nothing outside it). */
  readAll: boolean;
  /** `time_entry:read_any`: other people's logged time. Without it a report counts only the caller's own. */
  readAnyTime: boolean;
  /** `time_entry:manage_rates` with cost tracking on: the only caller who may see rates and costs. */
  showRates: boolean;
  now: Date;
  window: ReportWindow;
  previous: ReportWindow;
  filters: ReportFilters;
  /** A predicate over alias `p` (project): the caller's reach, applied to every query. */
  reach: SQL;
  /** Extra options of one report (`cycle`, `stale_days`, ...). */
  options: Record<string, string>;
  /**
   * RP-9: whether closed days may be read from `metric_snapshot` (tests switch it off to compare with
   * a live run) and how this run read them, which the envelope states. Mutated while the report runs.
   */
  snapshots: {
    enabled: boolean;
    use: SnapshotUse;
    sources: {
      metricSnapshot: boolean;
      cycleSnapshot: boolean;
      liveComponents: Set<string>;
      snapshotDayKeys: Set<string>;
      uncoveredDayKeys: Set<string>;
    };
  };
  /**
   * RP-10: an export is running in the background, so a report may return more rows than the screen
   * does. Reports that cap their rows read `rowCap(ctx, n)`.
   */
  exporting: boolean;
  /** One stable page of a queued CSV; screen/detail runs leave this unset. */
  exportPage?: { offset: number; limit: number };
};

/** A selectable option of one report (the cycle a burndown shows, how a breach analysis groups). */
export type ReportChoice = {
  key: string;
  values: Array<{ value: string; label: string }>;
  selected: string | null;
};

export type ReportBody = {
  /** Options the screen offers as a select; the selected one comes back from the URL. */
  choices?: ReportChoice[];
  metrics: Metric[];
  chart: Chart | null;
  columns: Column[];
  rows: Row[];
  /** Rows beyond the cap are cut and this says so. */
  truncated?: boolean;
  /** RP-5: how many things the report looked at inside the window; zero renders "—". */
  population: number;
  /** RP-5: the same population outside the window ("No data in this period", with the total outside it). */
  outsideWindow: number;
  /** RP-5: items left out and why (`no_estimate`, `unpriced`, `no_sla`, ...). */
  excluded: { count: number; reason: string } | null;
  /** Stable note codes the web translates (`sla_policy_changed`, `archived_projects`, ...). */
  notes: string[];
  /** The report can list the items behind a row (RP-12). */
  drill: boolean;
};

export type ReportDefinition = {
  key: string;
  category: ReportCategory;
  title: string;
  /** Needs a workspace feature on top of `feature.reports`. */
  feature?: "feature.time_tracking" | "feature.knowledge_base";
  /** The report carries rate or cost data and is shaped by `showRates`. */
  rated?: boolean;
  /** Does not depend on the window (live, at-risk, now). */
  live?: boolean;
  /** This definition can render every result row as bounded queued CSV pages. */
  pagedExport?: boolean;
  /** Static options (`by`, `metric`, `days`): the first value is the default. */
  options?: Array<{ key: string; values: string[] }>;
  compute: (ctx: ReportContext) => Promise<ReportBody>;
  /** Work items behind a row (RP-12). */
  drillItems?: (
    ctx: ReportContext,
    handle: string | null,
    limit: number,
  ) => Promise<DrillItem[]>;
};

/**
 * RP-12: one thing behind a number. Most reports count work items; time reports count time entries
 * and the knowledge base report counts articles, so the kind says which fields are filled.
 * A time entry carries hours only: never a rate or a cost, whoever asks (TC-11).
 */
export type DrillItem = {
  kind: "work_item" | "time_entry" | "cost_entry" | "article";
  key: string;
  title: string;
  projectKey: string | null;
  state: string | null;
  priority: string | null;
  /** `time_entry`: the day it was logged for. */
  date?: string | null;
  /** `time_entry`: who logged it. */
  person?: string | null;
  /** `time_entry`: the logged hours. */
  hours?: number | null;
  /** `time_entry`: the work item it was logged on. */
  workItemKey?: string | null;
  /** `time_entry` or `cost_entry`: currency only; rates and amounts are never returned. */
  currency?: string | null;
};

export type { Sampled };
