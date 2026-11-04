import type { Page } from "@playwright/test";
import {
  DEFAULT_RESOLVED_FEATURES,
  WORKSPACE_ID,
} from "./g11-performance-fixture";

/**
 * Network-edge fixture for the Reports area and the agent Dashboard, on top of
 * `installPerformanceApiFixture` (session, shell). Registered after it, so these routes answer
 * first and everything else falls back to the base fixture. The base fixture resolves every P5
 * flag off; this one answers the same resolved-flag reads with `feature.reports` on, which is what
 * `ReportsFeatureGate` and the navigation read for the active workspace.
 *
 * The data is chosen to stress the fit rules (3 Nov): a 26-bucket weekly chart that is wider than
 * a phone, a three-series chart whose legend wraps, a seven-column table, and the full
 * scope/window/as-of caption under every KPI tile.
 */

const asOf = "2026-10-21T12:00:00.000Z";
const window30 = {
  preset: "30",
  from: "2026-09-21T12:00:00.000Z",
  to: "2026-10-21T12:00:00.000Z",
  days: 30,
  live: false,
};
const windowLive = { ...window30, live: true };
const snapshot = {
  closedDays: 30,
  uncoveredDays: 0,
  computedAt: "2026-10-21T02:00:00.000Z",
  through: "2026-10-21T00:00:00.000Z",
};

const envelopeBase = {
  key: "throughput",
  title: "Throughput",
  category: "delivery",
  tier: 1,
  scope: { kind: "all", projectCount: 1 },
  window: window30,
  asOf,
  boundary: "mixed",
  sources: {
    metricSnapshot: true,
    cycleSnapshot: false,
    liveComponents: ["current_period"],
  },
  snapshot,
  filters: {},
  options: {},
  choices: [],
  metrics: [] as unknown[],
  chart: null as unknown,
  columns: [] as unknown[],
  rows: [] as unknown[],
  truncated: false,
  empty: null,
  excluded: null,
  notes: [],
  drill: false,
  costVisible: true,
};

/** 26 weekly buckets from 2026-04-27: more columns than a phone-width chart can hold. */
export const THROUGHPUT_WEEKS = Array.from({ length: 26 }, (_, index) =>
  new Date(Date.UTC(2026, 3, 27 + index * 7)).toISOString().slice(0, 10),
);
const throughputValues = THROUGHPUT_WEEKS.map(
  (_, index) => 6 + ((index * 5) % 9),
);

export const THROUGHPUT = {
  ...envelopeBase,
  metrics: [
    {
      key: "completed",
      label: "Items completed",
      unit: "count",
      value: 42,
      n: 42,
      needed: 0,
      trend: { status: "ok", direction: "up", delta: 6, previous: 36 },
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: THROUGHPUT_WEEKS,
    series: [
      { key: "completed", label: "Completed", values: throughputValues },
    ],
  },
  columns: [
    { key: "week", label: "Week starting", kind: "date" },
    { key: "completed", label: "Completed", kind: "number" },
  ],
  rows: THROUGHPUT_WEEKS.map((week, index) => ({
    week,
    completed: throughputValues[index],
    _drill: week,
  })),
  drill: true,
};

export const SLA_ATTAINMENT = {
  ...envelopeBase,
  key: "sla_attainment",
  title: "SLA attainment",
  category: "promises",
  metrics: [
    {
      key: "attainment",
      label: "Attainment",
      unit: "percent",
      value: 92,
      n: 48,
      needed: 10,
      trend: { status: "ok", direction: "up", delta: 4, previous: 88 },
    },
    { key: "met", label: "Met", unit: "count", value: 44, n: 44, needed: 0 },
    {
      key: "missed",
      label: "Missed",
      unit: "count",
      value: 4,
      n: 4,
      needed: 0,
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: [
      "Infrastructure managed services platform",
      "Help Desk",
      "Finance and payroll operations",
      "Network",
    ],
    series: [
      { key: "met", label: "Met", values: [4, 12, 19, 9] },
      { key: "missed", label: "Missed", values: [1, 2, 1, 0] },
      { key: "paused", label: "Paused for the customer", values: [0, 1, 2, 1] },
    ],
  },
  columns: [
    { key: "priority", label: "Priority", kind: "text" },
    { key: "met", label: "Met", kind: "number" },
    { key: "missed", label: "Missed", kind: "number" },
    { key: "attainment", label: "Attainment", kind: "percent" },
  ],
  rows: [
    { priority: "urgent", met: 4, missed: 1, attainment: 80, _drill: "urgent" },
    { priority: "high", met: 12, missed: 2, attainment: 86, _drill: "high" },
    {
      priority: "medium",
      met: 19,
      missed: 1,
      attainment: 95,
      _drill: "medium",
    },
    { priority: "low", met: 9, missed: 0, attainment: 100, _drill: "low" },
  ],
  drill: true,
};

export const AT_RISK_NOW = {
  ...envelopeBase,
  key: "at_risk_now",
  title: "At-risk now",
  category: "promises",
  window: windowLive,
  boundary: "live",
  sources: {
    metricSnapshot: false,
    cycleSnapshot: false,
    liveComponents: ["current_state"],
  },
  snapshot: null,
  metrics: [
    {
      key: "at_risk",
      label: "At risk",
      unit: "count",
      value: 3,
      n: 3,
      needed: 0,
    },
    {
      key: "breached",
      label: "Already breached",
      unit: "count",
      value: 1,
      n: 1,
      needed: 0,
    },
  ],
  columns: [
    { key: "key", label: "Key", kind: "text" },
    { key: "title", label: "Title", kind: "text" },
    { key: "project", label: "Project", kind: "text" },
    { key: "assignee", label: "Assignee", kind: "text" },
    { key: "metric", label: "Clock", kind: "text" },
    { key: "state", label: "State", kind: "text" },
    { key: "due", label: "Due", kind: "date" },
  ],
  rows: [
    {
      key: "HELP-7",
      title: "Customer cannot reset their password",
      project: "Help Desk",
      assignee: "Ada Example",
      metric: "Resolution",
      state: "In progress",
      due: "2026-10-21T15:30:00.000Z",
    },
    {
      key: "INFRA-1234",
      title:
        "Production VPN gateway keeps dropping connections for the Singapore office",
      project: "Infrastructure managed services platform",
      assignee: "Maximilian Alexander Featherstonehaugh",
      metric: "First response",
      state: "Backlog",
      due: "2026-10-21T16:00:00.000Z",
    },
    {
      key: "HELP-4",
      title: "Shared mailbox missing for the finance team",
      project: "Help Desk",
      assignee: null,
      metric: "Resolution",
      state: "Backlog",
      due: "2026-10-22T09:00:00.000Z",
    },
  ],
};

export const AGEING = {
  ...envelopeBase,
  key: "ageing",
  title: "Ageing",
  category: "delivery",
  window: windowLive,
  boundary: "live",
  sources: {
    metricSnapshot: false,
    cycleSnapshot: false,
    liveComponents: ["current_state"],
  },
  snapshot: null,
  metrics: [
    {
      key: "open",
      label: "Open items",
      unit: "count",
      value: 23,
      n: 23,
      needed: 0,
    },
    {
      key: "over_30",
      label: "Older than 30 days",
      unit: "count",
      value: 5,
      n: 5,
      needed: 0,
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: [
      "< 1 day",
      "1-3 days",
      "4-7 days",
      "8-14 days",
      "15-30 days",
      "31-60 days",
      "61-90 days",
      "> 90 days",
    ],
    series: [
      { key: "open", label: "Open items", values: [2, 4, 3, 4, 5, 3, 1, 1] },
    ],
  },
  columns: [
    { key: "bucket", label: "Age", kind: "bucket" },
    { key: "items", label: "Open items", kind: "number" },
  ],
  rows: [
    { bucket: "< 1 day", items: 2, _drill: "lt1" },
    { bucket: "1-3 days", items: 4, _drill: "d1_3" },
    { bucket: "4-7 days", items: 3, _drill: "d4_7" },
    { bucket: "8-14 days", items: 4, _drill: "d8_14" },
    { bucket: "15-30 days", items: 5, _drill: "d15_30" },
    { bucket: "31-60 days", items: 3, _drill: "d31_60" },
    { bucket: "61-90 days", items: 1, _drill: "d61_90" },
    { bucket: "> 90 days", items: 1, _drill: "gt90" },
  ],
  drill: true,
};

const CUSTOM_PREVIEW = {
  ...envelopeBase,
  key: "custom",
  title: "Custom report",
  boundary: "live",
  sources: {
    metricSnapshot: false,
    cycleSnapshot: false,
    liveComponents: ["selected_period"],
  },
  snapshot: null,
  options: { chartType: "bar" },
  metrics: [
    {
      key: "total",
      label: "Items",
      unit: "count",
      value: 53,
      n: 53,
      needed: 0,
    },
  ],
  chart: {
    type: "bar",
    unit: "count",
    categories: ["high", "low", "medium", "none", "urgent"],
    series: [{ key: "value", label: "Count", values: [14, 9, 21, 3, 6] }],
  },
  columns: [
    { key: "group", label: "Group", kind: "text" },
    { key: "value", label: "Count", kind: "number" },
  ],
  rows: [
    { group: "high", value: 14, _drill: "high" },
    { group: "low", value: 9, _drill: "low" },
    { group: "medium", value: 21, _drill: "medium" },
    { group: "none", value: 3, _drill: "none" },
    { group: "urgent", value: 6, _drill: "urgent" },
  ],
  drill: true,
  costVisible: false,
};

function catalogueEntry(
  key: string,
  title: string,
  category: string,
  live = false,
) {
  return { key, title, category, tier: 1, live, available: true, options: [] };
}

const CATALOGUE = {
  data: [
    catalogueEntry("sla_attainment", "SLA attainment", "promises"),
    catalogueEntry("at_risk_now", "At-risk now", "promises", true),
    catalogueEntry("throughput", "Throughput", "delivery"),
    catalogueEntry("ageing", "Ageing", "delivery", true),
    {
      ...catalogueEntry("time_logged", "Time logged", "time"),
      options: [{ key: "by", values: ["project", "person", "activity"] }],
    },
  ],
  meta: {
    scope: "all",
    canExport: true,
    canSeeRates: true,
    canManageWorkspaceDashboards: true,
  },
};

const DASHBOARD_SUMMARY = {
  id: "fit-dashboard",
  workspaceId: "ws-g11",
  ownerId: null,
  name: "Support overview",
  scope: "workspace",
  isDefault: true,
  version: 3,
  canEdit: true,
  widgetCount: 7,
  createdAt: "2026-09-02T09:00:00.000Z",
  updatedAt: "2026-10-14T15:20:00.000Z",
};

function widget(
  id: string,
  reportKey: string,
  chartType: string,
  cell: { x: number; y: number; w: number; h: number },
) {
  return { id, reportKey, savedViewId: null, chartType, filters: {}, ...cell };
}

const DASHBOARD_DETAIL = {
  ...DASHBOARD_SUMMARY,
  widgets: [
    widget("w-sla", "sla_attainment", "number", { x: 0, y: 0, w: 4, h: 2 }),
    widget("w-at-risk", "at_risk_now", "number", { x: 4, y: 0, w: 4, h: 2 }),
    widget("w-completed", "throughput", "number", { x: 8, y: 0, w: 4, h: 2 }),
    widget("w-throughput", "throughput", "bar", { x: 0, y: 2, w: 6, h: 4 }),
    widget("w-ageing", "ageing", "table", { x: 6, y: 2, w: 6, h: 4 }),
    widget("w-sla-chart", "sla_attainment", "bar", { x: 0, y: 6, w: 6, h: 4 }),
    widget("w-at-risk-table", "at_risk_now", "table", {
      x: 6,
      y: 6,
      w: 6,
      h: 4,
    }),
  ],
};

const WIDGET_DATA: Record<string, unknown> = {
  "w-sla": SLA_ATTAINMENT,
  "w-at-risk": AT_RISK_NOW,
  "w-completed": THROUGHPUT,
  "w-throughput": THROUGHPUT,
  "w-ageing": AGEING,
  "w-sla-chart": SLA_ATTAINMENT,
  "w-at-risk-table": AT_RISK_NOW,
};

const REPORTS: Record<string, unknown> = {
  throughput: THROUGHPUT,
  sla_attainment: SLA_ATTAINMENT,
  at_risk_now: AT_RISK_NOW,
  ageing: AGEING,
};

const EXPORT = {
  data: {
    id: "fit-export",
    kind: "report",
    reportKey: "time_logged",
    title: "Time logged",
    status: "ready",
    rowCount: 1240,
    byteSize: 96512,
    truncated: false,
    error: null,
    downloadCount: 0,
    createdAt: "2026-10-21T09:12:00.000Z",
    finishedAt: "2026-10-21T09:12:41.000Z",
    expiresAt: "2026-10-22T09:12:41.000Z",
  },
};

/** A fresh deployment's resolved switches with Reports turned on. */
const RESOLVED_FEATURES = {
  features: DEFAULT_RESOLVED_FEATURES.map((feature) =>
    feature.key === "feature.reports" ? { ...feature, enabled: true } : feature,
  ),
};

function bodyFor(path: string): unknown {
  if (
    path === "/api/features/resolved" ||
    path === `/api/workspaces/${WORKSPACE_ID}/features/resolved`
  )
    return RESOLVED_FEATURES;
  if (path === "/api/reports") return CATALOGUE;
  if (path === "/api/reports/custom/preview") return CUSTOM_PREVIEW;
  const report = /^\/api\/reports\/([a-z_]+)$/u.exec(path);
  if (report?.[1] && REPORTS[report[1]]) return REPORTS[report[1]];
  if (path === "/api/report-exports/fit-export") return EXPORT;
  if (path === "/api/dashboards")
    return {
      data: [DASHBOARD_SUMMARY],
      meta: { canManageWorkspaceDashboards: true },
    };
  if (path === "/api/dashboards/fit-dashboard") return DASHBOARD_DETAIL;
  const data =
    /^\/api\/dashboards\/fit-dashboard\/widgets\/([\w-]+)\/data$/u.exec(path);
  if (data?.[1] && WIDGET_DATA[data[1]]) return WIDGET_DATA[data[1]];
  return undefined;
}

export async function installReportsFitFixture(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = bodyFor(path);
    if (body === undefined) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}
