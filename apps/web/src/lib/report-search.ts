import { isCalendarDate } from "./time-minutes";

/**
 * Reports (`RP-7`, `RP-8`): the whole filter state of a report is in the URL, so a link to what
 * you are looking at reproduces it. Defaults (a 30 day window, the chart view) are never written.
 */
export const REPORT_WINDOWS = ["7", "30", "60", "90", "custom"] as const;
export type ReportWindowChoice = (typeof REPORT_WINDOWS)[number];
export const REPORT_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const REPORT_VIEWS = ["chart", "table"] as const;
export const REPORT_CATEGORIES = [
  "promises",
  "customers",
  "delivery",
  "people",
  "leadership",
  "agile",
  "time",
  "knowledge",
] as const;
export type ReportCategoryChoice = (typeof REPORT_CATEGORIES)[number];

export type ReportSearch = {
  window?: ReportWindowChoice;
  from?: string;
  to?: string;
  projectId?: string;
  organisationId?: string;
  teamId?: string;
  typeId?: string;
  priority?: (typeof REPORT_PRIORITIES)[number];
  /** Report-specific options: how a breach analysis groups, which clock, how stale, which cycle. */
  by?: string;
  metric?: "resolution" | "first_response";
  days?: "7" | "14" | "30" | "60" | "90";
  cycle?: string;
  view?: (typeof REPORT_VIEWS)[number];
  /** Drill-down (`RP-12`): the row whose items are open. */
  drill?: string;
};

const FREE_TEXT = [
  "projectId",
  "organisationId",
  "teamId",
  "typeId",
  "by",
  "cycle",
  "drill",
] as const;

function text(value: unknown) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 200 &&
    !value.includes("\u0000")
    ? value
    : undefined;
}

export function parseReportSearch(raw: unknown): ReportSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const window = REPORT_WINDOWS.find(
    (candidate) => candidate === String(value.window),
  );
  const custom = window === "custom";
  const from = custom && isCalendarDate(value.from) ? value.from : undefined;
  const to = custom && isCalendarDate(value.to) ? value.to : undefined;
  const priority = REPORT_PRIORITIES.find(
    (candidate) => candidate === value.priority,
  );
  const view = REPORT_VIEWS.find((candidate) => candidate === value.view);
  const days = (["7", "14", "30", "60", "90"] as const).find(
    (candidate) => candidate === String(value.days),
  );
  const search: ReportSearch = {};
  if (window && window !== "30") search.window = window;
  if (from) search.from = from;
  if (to) search.to = to;
  for (const key of FREE_TEXT) {
    const parsed = text(value[key]);
    if (parsed) search[key] = parsed;
  }
  if (priority) search.priority = priority;
  if (value.metric === "first_response") search.metric = "first_response";
  if (days) search.days = days;
  if (view && view !== "chart") search.view = view;
  return search;
}

/** The query string of a report URL (also the API query, bar `view` and `drill`). */
export function reportQuery(search: ReportSearch, forApi = false) {
  const params = new URLSearchParams();
  const resolved = parseReportSearch(search);
  for (const [key, value] of Object.entries(resolved)) {
    if (forApi && (key === "view" || key === "drill")) continue;
    if (typeof value === "string") params.set(key, value);
  }
  return params;
}

export type ReportsIndexSearch = { category?: ReportCategoryChoice };

export function parseReportsIndexSearch(raw: unknown): ReportsIndexSearch {
  const value = (raw ?? {}) as Record<string, unknown>;
  const category = REPORT_CATEGORIES.find(
    (candidate) => candidate === value.category,
  );
  return category ? { category } : {};
}

/** The tier 3 builder: an optional saved view to open, otherwise a blank query. */
export type ReportBuilderSearch = { view?: string };

export function parseReportBuilderSearch(raw: unknown): ReportBuilderSearch {
  const view = text((raw as Record<string, unknown> | null)?.view);
  return view ? { view } : {};
}

/** The dashboard and its editor: which dashboard (the default is the first). */
export type DashboardSearch = { id?: string };

export function parseDashboardSearch(raw: unknown): DashboardSearch {
  const id = text((raw as Record<string, unknown> | null)?.id);
  return id ? { id } : {};
}
