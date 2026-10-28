import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import { type ReportSearch, reportQuery } from "@/lib/report-search";

/** Reports and dashboards (`RP-1`..`RP-18`): the envelope every report comes back in. */

export type ReportCell = string | number | null | { n: number; needed: number };

export type ReportColumn = {
  key: string;
  label: string;
  kind:
    | "text"
    | "number"
    | "percent"
    | "hours"
    | "days"
    | "date"
    | "money"
    | "bucket";
};

export type ReportTrend =
  | {
      status: "ok";
      direction: "up" | "down" | "flat";
      delta: number;
      previous: number;
    }
  | { status: "insufficient"; reason: "needs_two_periods" };

export type ReportMetric = {
  key: string;
  label: string;
  unit: "percent" | "count" | "hours" | "days" | "score" | "money";
  value: number | null;
  n: number;
  needed: number;
  trend?: ReportTrend;
  currency?: string;
};

export type ReportChartData = {
  type: "bar" | "line";
  unit: ReportMetric["unit"];
  categories: string[];
  series: Array<{ key: string; label: string; values: Array<number | null> }>;
};

export type ReportEnvelope = {
  key: string;
  title: string;
  category: string;
  tier: 1;
  scope: { kind: "all" | "reach"; projectCount: number };
  window: {
    preset: string;
    from: string;
    to: string;
    days: number;
    live: boolean;
  };
  asOf: string;
  /** `RP-9`: where the numbers came from; `snapshot` is closed days only, `mixed` adds a live current day. */
  boundary: "live" | "snapshot" | "mixed";
  /** Historical source families and live components; absent on older stored dashboard payloads. */
  sources?: {
    metricSnapshot: boolean;
    cycleSnapshot: boolean;
    liveComponents: string[];
  };
  snapshot: {
    closedDays: number;
    uncoveredDays: number;
    computedAt: string | null;
    /** The end of the last stored day: everything after it is computed live. */
    through: string | null;
  } | null;
  filters: Record<string, string | undefined>;
  options: Record<string, string>;
  choices: Array<{
    key: string;
    values: Array<{ value: string; label: string }>;
    selected: string | null;
  }>;
  metrics: ReportMetric[];
  chart: ReportChartData | null;
  columns: ReportColumn[];
  rows: Array<Record<string, ReportCell>>;
  truncated: boolean;
  empty: {
    reason: "no_data_in_window" | "no_data";
    outsideWindow: number;
    excluded: { count: number; reason: string } | null;
  } | null;
  excluded: { count: number; reason: string } | null;
  notes: string[];
  drill: boolean;
  costVisible: boolean;
};

export type ReportCatalogueEntry = {
  key: string;
  title: string;
  category: string;
  tier: 1;
  live: boolean;
  available: boolean;
  options: Array<{ key: string; values: string[] }>;
};

export type ReportCatalogue = {
  data: ReportCatalogueEntry[];
  meta: {
    scope: "all" | "reach";
    canExport: boolean;
    canSeeRates: boolean;
    canManageWorkspaceDashboards: boolean;
  };
};

/** `RP-12`: one thing behind a number: a work item, a time entry (hours only) or a knowledge base article. */
export type DrillItem = {
  kind: "work_item" | "time_entry" | "cost_entry" | "article";
  key: string;
  title: string;
  projectKey: string | null;
  state: string | null;
  priority: string | null;
  date?: string | null;
  person?: string | null;
  hours?: number | null;
  workItemKey?: string | null;
  currency?: string | null;
};

/** `RP-10`: an export that was queued for the background job. */
export type ReportExportInfo = {
  id: string;
  kind: "report" | "custom";
  reportKey: string | null;
  title: string;
  status: "queued" | "running" | "ready" | "failed" | "expired";
  rowCount: number | null;
  byteSize: number | null;
  truncated: boolean;
  error: string | null;
  downloadCount: number;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
};

/** A small export is the file itself; a large one is queued and polled. */
export type ExportOutcome =
  | { kind: "file"; filename: string; blob: Blob }
  | { kind: "queued"; export: ReportExportInfo };

export type DashboardWidget = {
  id: string;
  reportKey: string | null;
  savedViewId: string | null;
  chartType: "bar" | "line" | "table" | "number";
  filters: Record<string, string>;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DashboardSummary = {
  id: string;
  workspaceId: string;
  ownerId: string | null;
  name: string;
  scope: "personal" | "workspace";
  isDefault: boolean;
  version: number;
  canEdit: boolean;
  widgetCount: number;
  createdAt: string;
  updatedAt: string;
};

export type DashboardDetail = DashboardSummary & {
  widgets: DashboardWidget[];
};

export type DashboardList = {
  data: DashboardSummary[];
  meta: { canManageWorkspaceDashboards: boolean };
};

export type WidgetInput = Omit<DashboardWidget, "id"> & { id?: string };

/** The feature switch is off: the API answers 409 `feature_disabled`. */
export class ReportsDisabledError extends HttpError {
  constructor() {
    super(409, "feature_disabled");
    this.name = "ReportsDisabledError";
  }
}

/** A rule the screen words itself (`version_conflict`, `name_taken`, `widgets_overlap`...). */
export class ReportRuleError extends HttpError {
  code: string;
  constructor(status: number, code: string) {
    super(status, code);
    this.name = "ReportRuleError";
    this.code = code;
  }
}

const RULE_CODES = new Set([
  "version_conflict",
  "name_taken",
  "widgets_overlap",
  "unknown_report",
  "saved_view_not_chart",
  "saved_view_not_runnable",
  "dashboard_limit",
  "invalid_window",
  "window_too_long",
  "window_order",
  "unsupported_filter",
  "unsupported_group",
  "unsupported_aggregate",
]);

async function failure(response: Response, fallback: string): Promise<never> {
  const detail = await readErrorDetail(response, fallback);
  if (response.status === 409 && detail === "feature_disabled")
    throw new ReportsDisabledError();
  if ([409, 422].includes(response.status) && RULE_CODES.has(detail))
    throw new ReportRuleError(response.status, detail);
  throw new HttpError(response.status, detail);
}

async function send(
  path: string,
  init: { method?: string; body?: unknown } = {},
  fallback = "The request failed",
): Promise<Response> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.method && init.method !== "GET"
      ? { headers: { "Content-Type": "application/json" } }
      : {}),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) await failure(response, fallback);
  return response;
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  fallback?: string,
): Promise<T> {
  return (await (await send(path, init, fallback)).json()) as T;
}

const enc = encodeURIComponent;

function apiQuery(workspaceId: string, search: ReportSearch) {
  const params = reportQuery(search, true);
  params.set("workspaceId", workspaceId);
  return params.toString();
}

export const getReportCatalogue = (workspaceId: string) =>
  request<ReportCatalogue>(
    `/reports?workspaceId=${enc(workspaceId)}`,
    {},
    "Failed to load the reports",
  );

export const getReport = (
  workspaceId: string,
  key: string,
  search: ReportSearch,
) =>
  request<ReportEnvelope>(
    `/reports/${enc(key)}?${apiQuery(workspaceId, search)}`,
    {},
    "Failed to run the report",
  );

export const getReportItems = (
  workspaceId: string,
  key: string,
  search: ReportSearch,
  handle: string | null,
) =>
  request<{ data: DrillItem[] }>(
    `/reports/${enc(key)}/items?${apiQuery(workspaceId, search)}${
      handle ? `&handle=${enc(handle)}` : ""
    }&limit=100`,
    {},
    "Failed to load the items",
  );

async function exportOutcome(
  response: Response,
  fallback: string,
): Promise<ExportOutcome> {
  if (response.status === 202) {
    const { data } = (await response.json()) as { data: ReportExportInfo };
    return { kind: "queued", export: data };
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallback;
  return { kind: "file", filename, blob: await response.blob() };
}

/**
 * `RP-10`: the CSV of what is on screen (never a rate), or, when the export is large, the queued
 * export to poll.
 */
export async function exportReport(
  workspaceId: string,
  key: string,
  search: ReportSearch,
): Promise<ExportOutcome> {
  const body: Record<string, string> = { workspaceId };
  for (const [name, value] of reportQuery(search, true)) body[name] = value;
  return exportOutcome(
    await send(
      `/reports/${enc(key)}/export`,
      { method: "POST", body },
      "Failed to export the report",
    ),
    `${key}.csv`,
  );
}

export async function exportCustomReport(input: {
  workspaceId: string;
  name?: string;
  query: CustomQueryInput;
  chartType: "bar" | "line" | "table" | "number";
}): Promise<ExportOutcome> {
  return exportOutcome(
    await send(
      "/reports/custom/export",
      { method: "POST", body: input },
      "Failed to export the report",
    ),
    "custom-report.csv",
  );
}

export async function exportWidget(
  dashboardId: string,
  widgetId: string,
): Promise<ExportOutcome> {
  return exportOutcome(
    await send(
      `/dashboards/${enc(dashboardId)}/widgets/${enc(widgetId)}/export`,
      { method: "POST", body: {} },
      "Failed to export the widget",
    ),
    "widget.csv",
  );
}

export const getReportExport = (id: string) =>
  request<{ data: ReportExportInfo }>(
    `/report-exports/${enc(id)}`,
    {},
    "Failed to load the export",
  );

/** The stored CSV of a finished export, from the authenticated download route. */
export async function downloadReportExport(
  id: string,
): Promise<{ filename: string; blob: Blob }> {
  const response = await send(
    `/report-exports/${enc(id)}/download`,
    {},
    "Failed to download the export",
  );
  const disposition = response.headers.get("content-disposition") ?? "";
  return {
    filename: /filename="([^"]+)"/.exec(disposition)?.[1] ?? "report.csv",
    blob: await response.blob(),
  };
}

export type CustomQueryInput = {
  entity: "work_item" | "time_entry";
  filter?: Record<string, string>;
  groupBy?: string;
  aggregate?: { fn: "count" | "sum"; field?: "minutes" };
};

export const previewCustomReport = (input: {
  workspaceId: string;
  name?: string;
  query: CustomQueryInput;
  chartType: "bar" | "line" | "table" | "number";
}) =>
  request<ReportEnvelope>(
    "/reports/custom/preview",
    { method: "POST", body: input },
    "Failed to preview the report",
  );

export const getDashboards = (workspaceId: string) =>
  request<DashboardList>(
    `/dashboards?workspaceId=${enc(workspaceId)}`,
    {},
    "Failed to load the dashboards",
  );

export const getDashboard = (id: string, workspaceId: string) =>
  request<DashboardDetail>(
    `/dashboards/${enc(id)}?workspaceId=${enc(workspaceId)}`,
    {},
    "Failed to load the dashboard",
  );

export const createDashboard = (input: {
  workspaceId: string;
  name: string;
  scope: "personal" | "workspace";
  isDefault?: boolean;
  widgets?: WidgetInput[];
}) =>
  request<DashboardDetail>(
    "/dashboards",
    { method: "POST", body: input },
    "Failed to create the dashboard",
  );

export const updateDashboard = (
  id: string,
  input: {
    version: number;
    name?: string;
    isDefault?: boolean;
    widgets?: WidgetInput[];
  },
) =>
  request<DashboardDetail>(
    `/dashboards/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the dashboard",
  );

/** Deleting a dashboard is a pending action; the requester approves it in the browser. */
export async function requestDashboardDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/dashboards/${enc(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the deletion",
  );
}

export const getWidgetData = (
  dashboardId: string,
  widgetId: string,
  workspaceId: string,
) =>
  request<ReportEnvelope>(
    `/dashboards/${enc(dashboardId)}/widgets/${enc(widgetId)}/data?workspaceId=${enc(workspaceId)}`,
    {},
    "Failed to load the widget",
  );

export const getWidgetItems = (
  dashboardId: string,
  widgetId: string,
  handle: string | null,
) =>
  request<{ data: DrillItem[] }>(
    `/dashboards/${enc(dashboardId)}/widgets/${enc(widgetId)}/items?limit=100${
      handle ? `&handle=${enc(handle)}` : ""
    }`,
    {},
    "Failed to load the items",
  );

export const getCustomItems = (input: {
  workspaceId: string;
  name?: string;
  query: CustomQueryInput;
  chartType: "bar" | "line" | "table" | "number";
  handle: string | null;
}) => {
  const { handle, ...rest } = input;
  return request<{ data: DrillItem[] }>(
    "/reports/custom/items",
    {
      method: "POST",
      body: { ...rest, ...(handle ? { handle } : {}), limit: 100 },
    },
    "Failed to load the items",
  );
};
