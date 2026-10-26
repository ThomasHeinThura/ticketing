import { HTTPException } from "hono/http-exception";
import db from "../database";
import { listWorkspaceFeatures } from "../feature-flag/repository";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  registeredDeletionRequestSchema,
  requestRegisteredDeletion,
} from "../pending-action/deletion-targets";
import { kickReportExport } from "../scheduler/report-jobs";
import { requireReachFilteredList } from "../utils/reach-filtered-list";
import { requireWorkspaceCapability } from "../utils/require-workspace-capability";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import getView from "../view/controllers/get-view";
import { auditReport } from "./audit";
import { buildContext, cleanFilters } from "./context";
import {
  CUSTOM_CHART_TYPES,
  customQuerySchema,
  customWindowInput,
  drillCustomReport,
  runCustomReport,
  validateCustomQuery,
} from "./custom";
import { layoutProblem, widgetWindowInput } from "./dashboard.logic";
import {
  createDashboard,
  DashboardLimitError,
  DashboardNameTakenError,
  DashboardVersionConflictError,
  ensureDefaultDashboard,
  getDashboard,
  getWidget,
  listDashboards,
  listWidgets,
  updateDashboard,
} from "./dashboard.repository";
import { DASHBOARD_DELETION_ROUTE } from "./deletion-target";
import { shouldQueueExport } from "./export.logic";
import {
  type ExportRow,
  ExportRuleError,
  type ExportSpec,
  enqueueExport,
  exportReachLost,
  getExport,
  listExports,
  recordDownload,
  renderExport,
  TooManyExportsError,
} from "./export.service";
import { workspaceFeatureEnabled } from "./feature";
import {
  actorOf,
  callerCaps,
  dashboardReach,
  exportReach,
  holds,
  identityOf,
  requireReports,
  staffOnly,
} from "./http";
import { type ReportWindow, resolveWindow } from "./logic";
import { REPORTS, reportByKey } from "./registry";
import { drillOf } from "./reports/drill-extra";
import {
  dashboardDetailSchema,
  dashboardListSchema,
  drillResponseSchema,
  exportEnvelopeSchema,
  exportListSchema,
  reportCatalogueSchema,
  reportEnvelopeSchema,
} from "./response";
import { ReportFeatureDisabledError, runReport } from "./run";
import {
  createDashboardBody,
  customItemsBody,
  customPreviewBody,
  dashboardIdParam,
  drillQuery,
  exportBody,
  exportIdParam,
  reportKeyParam,
  reportQuery,
  updateDashboardBody,
  widgetItemsQuery,
  widgetParam,
  workspaceIdQuery,
} from "./schema";
import type { ReportDefinition } from "./types";

type Vars = BaseVariables & { workspaceId: string };

const read = [
  staffOnly,
  requireWorkspaceCapability("report:read"),
  requireReports,
] as const;
const exporting = [
  staffOnly,
  requireWorkspaceCapability("report:export"),
  requireReports,
] as const;

function windowOrThrow(
  input: {
    window?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
  },
  now: Date,
): ReportWindow {
  const result = resolveWindow(input, now);
  if (!result.ok) throw new HTTPException(422, { message: result.reason });
  return result.window;
}

function definitionOf(key: string): ReportDefinition {
  const def = reportByKey(key);
  if (!def) throw new HTTPException(404, { message: "Report not found" });
  return def;
}

function disabled(error: unknown): never {
  if (error instanceof ReportFeatureDisabledError)
    throw new HTTPException(409, { message: "feature_disabled" });
  throw error;
}

const listReportsRoute = createRoute({
  method: "get",
  path: "/reports",
  operationId: "listReports",
  tags: ["Reports"],
  summary: "The report catalogue",
  description:
    "Tier 1 reports with their options and whether the workspace has the feature each one needs. Customers receive 403.",
  middleware: [
    staffOnly,
    workspaceAccess.fromQuery(),
    requireWorkspaceCapability("report:read"),
    requireReports,
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Reports", reportCatalogueSchema),
    403: errorResponse("Not staff, or missing report:read"),
    409: errorResponse("feature.reports is off"),
  },
});

const reportRoute = createRoute({
  method: "get",
  path: "/reports/{key}",
  operationId: "getReport",
  tags: ["Reports"],
  summary: "Run a tier 1 report",
  description:
    "Filtered to the caller's reach (report:read) or the whole workspace (report:read_all). States scope, window and as-of time. Insufficient data is null with its sample, never 0% or 100%. Rate and cost fields are absent without time_entry:manage_rates.",
  middleware: [
    staffOnly,
    workspaceAccess.fromQuery(),
    ...read.slice(1),
    requireReachFilteredList,
  ] as const,
  request: { params: reportKeyParam, query: reportQuery },
  responses: {
    200: jsonResponse("The report", reportEnvelopeSchema),
    403: errorResponse("Not staff, or missing report:read"),
    404: errorResponse("Unknown report"),
    409: errorResponse("feature.reports (or the report's own feature) is off"),
    422: errorResponse("Invalid window"),
  },
});

const drillRoute = createRoute({
  method: "get",
  path: "/reports/{key}/items",
  operationId: "listReportItems",
  tags: ["Reports"],
  summary: "The work items behind a report number",
  description:
    "Drill-down (RP-12): the same population and filters as the report, optionally narrowed to one row (`handle`).",
  middleware: [
    staffOnly,
    workspaceAccess.fromQuery(),
    ...read.slice(1),
    requireReachFilteredList,
  ] as const,
  request: { params: reportKeyParam, query: drillQuery },
  responses: {
    200: jsonResponse("Items", drillResponseSchema),
    403: errorResponse("Not staff, or missing report:read"),
    404: errorResponse("Unknown report"),
    409: errorResponse("Feature off"),
    422: errorResponse("Invalid window"),
  },
});

const exportResponses = {
  200: {
    description: "CSV",
    content: { "text/csv": { schema: reportKeyParam.shape.key } },
  },
  202: jsonResponse(
    "A large export was queued: poll GET /api/report-exports/{id}",
    exportEnvelopeSchema,
  ),
  403: errorResponse("Not staff, or missing report:export"),
  404: errorResponse("Unknown report"),
  409: errorResponse("Feature off"),
  422: errorResponse("Invalid window"),
  429: errorResponse("Too many exports queued or running for this person"),
} as const;

const exportRoute = createRoute({
  method: "post",
  path: "/reports/{key}/export",
  operationId: "exportReport",
  tags: ["Reports"],
  summary: "Export a report as CSV",
  description:
    "Respects the filters and the caller's reach, carries no rate data without time_entry:manage_rates, neutralises spreadsheet formulas, and is audited (report.exported). A small export is the CSV itself (200); one that hit the report's row cap or is above 150 rows is queued for the report-export job (202) and downloaded from /api/report-exports/{id}/download. API-key and impersonated requests are always answered synchronously, with any truncation stated in the CSV.",
  middleware: [
    staffOnly,
    workspaceAccess.fromBody(),
    ...exporting.slice(1),
  ] as const,
  request: {
    params: reportKeyParam,
    body: {
      required: true,
      content: { "application/json": { schema: exportBody } },
    },
  },
  responses: exportResponses,
});

const customExportRoute = createRoute({
  method: "post",
  path: "/reports/custom/export",
  operationId: "exportCustomReport",
  tags: ["Reports"],
  summary: "Export a tier 3 report as CSV",
  description:
    "The same body as the preview. Same rules as a fixed report export: reach, no rates, audited, queued above the synchronous limit.",
  middleware: [
    staffOnly,
    workspaceAccess.fromBody(),
    ...exporting.slice(1),
    requireReachFilteredList,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: customPreviewBody } },
    },
  },
  responses: exportResponses,
});

const customItemsRoute = createRoute({
  method: "post",
  path: "/reports/custom/items",
  operationId: "listCustomReportItems",
  tags: ["Reports"],
  summary: "The items behind one group of a tier 3 report",
  description:
    "Drill-down (RP-12) for a custom report: the same entity, filters, window and reach, narrowed by the row handle. Epic handles bind an opaque epic ID; other groups retain their existing label handles. Time entries carry hours only.",
  middleware: [
    staffOnly,
    workspaceAccess.fromBody(),
    ...read.slice(1),
    requireReachFilteredList,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: customItemsBody } },
    },
  },
  responses: {
    200: jsonResponse("Items", drillResponseSchema),
    403: errorResponse("Not staff, or missing report:read"),
    409: errorResponse("feature.reports is off"),
    422: errorResponse("Unsupported filter, grouping or aggregate"),
  },
});

const listExportsRoute = createRoute({
  method: "get",
  path: "/report-exports",
  operationId: "listReportExports",
  tags: ["Reports"],
  summary: "The caller's recent exports",
  description: "Only the caller's own exports in this workspace.",
  middleware: [
    staffOnly,
    workspaceAccess.fromQuery(),
    ...exporting.slice(1),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Exports", exportListSchema),
    403: errorResponse("Not staff, or missing report:export"),
    409: errorResponse("feature.reports is off"),
  },
});

const getExportRoute = createRoute({
  method: "get",
  path: "/report-exports/{id}",
  operationId: "getReportExport",
  tags: ["Reports"],
  summary: "The status of one export",
  description:
    "Another person's export, or one in another workspace, is a 404.",
  middleware: [staffOnly, exportReach, ...exporting.slice(1)] as const,
  request: { params: exportIdParam },
  responses: {
    200: jsonResponse("The export", exportEnvelopeSchema),
    403: errorResponse("Not staff, or missing report:export"),
    404: errorResponse("Export not found"),
    409: errorResponse("feature.reports is off"),
  },
});

const downloadExportRoute = createRoute({
  method: "get",
  path: "/report-exports/{id}/download",
  operationId: "downloadReportExport",
  tags: ["Reports"],
  summary: "Download a finished export",
  description:
    "Streams the stored CSV to its requester and audits report.exported. 409 while queued or running or after it failed, 410 once expired, 403 when the file carries rate data and the caller may no longer see rates.",
  middleware: [staffOnly, exportReach, ...exporting.slice(1)] as const,
  request: { params: exportIdParam },
  responses: {
    200: {
      description: "CSV",
      content: { "text/csv": { schema: exportIdParam.shape.id } },
    },
    403: errorResponse("Not staff, missing report:export, or rates revoked"),
    404: errorResponse("Export not found"),
    409: errorResponse("Not ready, or failed"),
    410: errorResponse("Expired"),
  },
});

const customPreviewRoute = createRoute({
  method: "post",
  path: "/reports/custom/preview",
  operationId: "previewCustomReport",
  tags: ["Reports"],
  summary: "Preview a tier 3 report without saving it",
  description:
    "A saved-view query with a groupBy and an aggregate over work items or time entries. Saving goes through POST /api/views with layout 'chart'.",
  middleware: [
    staffOnly,
    workspaceAccess.fromBody(),
    ...read.slice(1),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: customPreviewBody } },
    },
  },
  responses: {
    200: jsonResponse("The result", reportEnvelopeSchema),
    403: errorResponse("Not staff, or missing report:read"),
    409: errorResponse("feature.reports is off"),
    422: errorResponse("Unsupported filter, grouping or aggregate"),
  },
});

const listDashboardsRoute = createRoute({
  method: "get",
  path: "/dashboards",
  operationId: "listDashboards",
  tags: ["Dashboards"],
  summary: "The caller's dashboards and the workspace's",
  description:
    "Creates the default dashboard on first use when the caller has none and the workspace has none (RP-16).",
  middleware: [
    staffOnly,
    workspaceAccess.fromQuery(),
    ...read.slice(1),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("Dashboards", dashboardListSchema),
    403: errorResponse("Not staff, or missing report:read"),
    409: errorResponse("feature.reports is off"),
  },
});

const createDashboardRoute = createRoute({
  method: "post",
  path: "/dashboards",
  operationId: "createDashboard",
  tags: ["Dashboards"],
  summary: "Create a dashboard",
  description:
    "Personal for the caller, or a workspace dashboard with workspace:manage_settings (RP-14). At most 20 widgets and 20 dashboards per scope.",
  middleware: [
    staffOnly,
    workspaceAccess.fromBody(),
    ...read.slice(1),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createDashboardBody } },
    },
  },
  responses: {
    201: jsonResponse("The dashboard", dashboardDetailSchema),
    403: errorResponse("Workspace dashboards need workspace:manage_settings"),
    409: errorResponse("Name taken, or feature off"),
    422: errorResponse("Invalid layout or widget"),
  },
});

const getDashboardRoute = createRoute({
  method: "get",
  path: "/dashboards/{id}",
  operationId: "getDashboard",
  tags: ["Dashboards"],
  summary: "A dashboard with its widgets",
  middleware: [staffOnly, dashboardReach, ...read.slice(1)] as const,
  request: { params: dashboardIdParam },
  responses: {
    200: jsonResponse("The dashboard", dashboardDetailSchema),
    403: errorResponse("Not staff, or missing report:read"),
    404: errorResponse("Dashboard not found"),
    409: errorResponse("feature.reports is off"),
  },
});

const updateDashboardRoute = createRoute({
  method: "patch",
  path: "/dashboards/{id}",
  operationId: "updateDashboard",
  tags: ["Dashboards"],
  summary: "Rename a dashboard or save its layout",
  description:
    "One atomic save of the whole layout guarded by `version`; a stale version is a 409. A personal dashboard is the owner's; a workspace dashboard needs workspace:manage_settings.",
  middleware: [staffOnly, dashboardReach, ...read.slice(1)] as const,
  request: {
    params: dashboardIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDashboardBody } },
    },
  },
  responses: {
    200: jsonResponse("The dashboard", dashboardDetailSchema),
    403: errorResponse("Not permitted to change this dashboard"),
    404: errorResponse("Dashboard not found"),
    409: errorResponse("Version conflict, name taken, or feature off"),
    422: errorResponse("Invalid layout or widget"),
  },
});

const deleteDashboardRoute = createRoute({
  method: "delete",
  path: "/dashboards/{id}",
  operationId: "deleteDashboard",
  tags: ["Dashboards"],
  summary: "Delete a dashboard",
  description: "Request deletion (202 pending action, click approval).",
  middleware: [staffOnly, dashboardReach, ...read.slice(1)] as const,
  request: { params: dashboardIdParam },
  responses: {
    202: jsonResponse(
      "Deletion awaiting approval",
      registeredDeletionRequestSchema,
    ),
    403: errorResponse("Not permitted to delete this dashboard"),
    404: errorResponse("Dashboard not found"),
    409: errorResponse("feature.reports is off"),
  },
});

const widgetDataRoute = createRoute({
  method: "get",
  path: "/dashboards/{id}/widgets/{wid}/data",
  operationId: "getDashboardWidgetData",
  tags: ["Dashboards"],
  summary: "The data behind one widget",
  description:
    "Runs the widget's report (any tier) for the caller: their reach, their rate visibility, the widget's own window and filters.",
  middleware: [
    staffOnly,
    dashboardReach,
    ...read.slice(1),
    requireReachFilteredList,
  ] as const,
  request: { params: widgetParam },
  responses: {
    200: jsonResponse("The report", reportEnvelopeSchema),
    403: errorResponse("Not staff, or missing report:read"),
    404: errorResponse("Dashboard, widget or saved view not found"),
    409: errorResponse("Feature off"),
    422: errorResponse("The widget's saved view cannot be run"),
  },
});

const widgetItemsRoute = createRoute({
  method: "get",
  path: "/dashboards/{id}/widgets/{wid}/items",
  operationId: "listDashboardWidgetItems",
  tags: ["Dashboards"],
  summary: "The items behind a widget number",
  description:
    "Drill-down (RP-12) for a widget: its report (any tier) under the widget's own window and filters and the caller's reach, optionally narrowed to one row (`handle`).",
  middleware: [
    staffOnly,
    dashboardReach,
    ...read.slice(1),
    requireReachFilteredList,
  ] as const,
  request: { params: widgetParam, query: widgetItemsQuery },
  responses: {
    200: jsonResponse("Items", drillResponseSchema),
    403: errorResponse("Not staff, or missing report:read"),
    404: errorResponse("Dashboard, widget or saved view not found"),
    409: errorResponse("Feature off"),
    422: errorResponse("The widget's saved view cannot be run"),
  },
});

const widgetExportRoute = createRoute({
  method: "post",
  path: "/dashboards/{id}/widgets/{wid}/export",
  operationId: "exportDashboardWidget",
  tags: ["Dashboards"],
  summary: "Export one widget as CSV",
  description:
    "The widget's report (any tier) with its own window and filters, for the caller: reach, no rates without time_entry:manage_rates, audited, queued above the synchronous limit.",
  middleware: [
    staffOnly,
    dashboardReach,
    ...exporting.slice(1),
    requireReachFilteredList,
  ] as const,
  request: { params: widgetParam },
  responses: exportResponses,
});

const router = apiRouter<Vars>();

function queryOptions(query: {
  by?: string | undefined;
  metric?: string | undefined;
  days?: string | undefined;
  cycle?: string | undefined;
}) {
  return {
    by: query.by,
    metric: query.metric,
    days: query.days,
    cycle: query.cycle,
  };
}

function filtersOf(query: Record<string, unknown>) {
  return cleanFilters(query);
}

type DashboardRowLike = Awaited<ReturnType<typeof getDashboard>>;

function dashboardDto(
  row: NonNullable<DashboardRowLike>,
  personId: string,
  canManage: boolean,
  widgetCount: number,
) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerId: row.ownerId,
    name: row.name,
    scope: row.scope,
    isDefault: row.isDefault,
    version: row.version,
    canEdit: row.scope === "workspace" ? canManage : row.ownerId === personId,
    widgetCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function detail(
  row: NonNullable<DashboardRowLike>,
  personId: string,
  canManage: boolean,
) {
  const widgets = await listWidgets(row.id);
  return {
    ...dashboardDto(row, personId, canManage, widgets.length),
    widgets: widgets.map((widget) => ({
      id: widget.id,
      reportKey: widget.reportKey,
      savedViewId: widget.savedViewId,
      chartType: widget.chartType,
      filters: widget.filters,
      x: widget.x,
      y: widget.y,
      w: widget.w,
      h: widget.h,
    })),
  };
}

/** A widget must name a real report, or a saved view the caller may see and that is a chart. */
async function checkWidgets(
  widgets: Array<{
    reportKey?: string | null | undefined;
    savedViewId?: string | null | undefined;
    x: number;
    y: number;
    w: number;
    h: number;
  }>,
  personId: string,
  userId: string,
) {
  for (const widget of widgets) {
    if (widget.reportKey && !reportByKey(widget.reportKey))
      throw new HTTPException(422, { message: "unknown_report" });
    if (widget.savedViewId) {
      const view = await getView(widget.savedViewId, personId, userId);
      if (view.layout !== "chart")
        throw new HTTPException(422, { message: "saved_view_not_chart" });
    }
  }
  if (layoutProblem(widgets))
    throw new HTTPException(422, { message: "widgets_overlap" });
}

function exportProblem(error: unknown): never {
  if (error instanceof ExportRuleError) {
    if (error.code === "unknown_report")
      throw new HTTPException(404, { message: "Report not found" });
    if (error.code === "feature_disabled")
      throw new HTTPException(409, { message: "feature_disabled" });
    if (error.code === "forbidden")
      throw new HTTPException(403, { message: "Insufficient permissions" });
    throw new HTTPException(422, { message: error.code });
  }
  throw error;
}

function exportDto(row: ExportRow) {
  return {
    id: row.id,
    kind: row.kind,
    reportKey: row.reportKey,
    title: row.title,
    status: row.status,
    rowCount: row.rowCount,
    byteSize: row.byteSize,
    truncated: row.truncated,
    error: row.error,
    downloadCount: row.downloadCount,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

/**
 * RP-10, one path for every export (a fixed report, a tier 3 report, a widget): run it on screen
 * terms for the caller; if it is small, that is the CSV (audited as it leaves); if it hit the row
 * cap or is above the synchronous limit, queue it for the `report-export` job (audited as
 * requested; the download is audited as it leaves). A request made with an API key or while
 * impersonating is never queued: the job could not reproduce the clamp, so it gets the synchronous
 * CSV with its truncation stated.
 */
async function runExport(
  c: Parameters<typeof actorOf>[0],
  workspaceId: string,
  spec: ExportSpec,
) {
  const now = new Date();
  const identity = await identityOf(c);
  const caps = await callerCaps(c);
  let rendered: Awaited<ReturnType<typeof renderExport>>;
  try {
    rendered = await renderExport({
      spec,
      workspaceId,
      identity,
      caps,
      now,
      exporting: false,
    });
  } catch (error) {
    return exportProblem(error);
  }
  const { envelope } = rendered;
  const session = c.get("session") as
    | { impersonatedBy?: string | null }
    | null
    | undefined;
  const mayQueue = !c.get("apiKey") && !session?.impersonatedBy;
  // The audit rows record what left and under which filters, never a rate or cost (TC-11).
  const detail = {
    report: spec.kind === "report" ? spec.key : "custom",
    format: "csv",
    scope: envelope.scope.kind,
    window: envelope.window,
    filters: envelope.filters,
    options: envelope.options,
  };
  const entityId = spec.kind === "report" ? spec.key : "custom";
  if (
    mayQueue &&
    shouldQueueExport({
      rows: envelope.rows.length,
      truncated: envelope.truncated,
    })
  ) {
    try {
      const row = await enqueueExport({
        workspaceId,
        personId: identity.personId,
        userId: c.get("userId") as string,
        spec,
        title: rendered.title,
        caps,
        now,
        audit: (tx, id) =>
          auditReport(tx, {
            action: "report.export_requested",
            workspaceId,
            entityType: "report_export",
            entityId: id,
            actor: actorOf(c),
            after: { ...detail, exportId: id, rows: envelope.rows.length },
          }),
      });
      kickReportExport();
      return c.json({ data: exportDto(row) }, 202);
    } catch (error) {
      if (error instanceof TooManyExportsError)
        throw new HTTPException(429, { message: "too_many_exports" });
      throw error;
    }
  }
  await db.transaction((tx) =>
    auditReport(tx, {
      action: "report.exported",
      workspaceId,
      entityType: "report",
      entityId,
      actor: actorOf(c),
      after: { ...detail, rows: envelope.rows.length, via: "sync" },
    }),
  );
  return c.body(rendered.csv, 200, {
    "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${rendered.filename}"`,
    "cache-control": "no-store",
  });
}

type WidgetRow = NonNullable<Awaited<ReturnType<typeof getWidget>>>;

/**
 * What a dashboard widget runs: its fixed report with the widget's own window, filters and
 * options, or its saved tier 2/3 view's query. The saved view is read as the caller (a view they
 * may not see is a 404), so a widget can never export or list what its viewer could not.
 */
async function widgetSpec(
  c: Parameters<typeof actorOf>[0],
  widget: WidgetRow,
  personId: string,
): Promise<ExportSpec> {
  const filters = widget.filters ?? {};
  const text = (key: string) =>
    typeof filters[key] === "string" ? (filters[key] as string) : undefined;
  if (widget.reportKey) {
    definitionOf(widget.reportKey);
    return {
      kind: "report",
      key: widget.reportKey,
      window: widgetWindowInput(filters),
      filters: cleanFilters(filters),
      options: {
        by: text("by"),
        metric: text("metric"),
        days: text("days"),
        cycle: text("cycle"),
      },
    };
  }
  const view = await getView(
    widget.savedViewId ?? "",
    personId,
    c.get("userId") as string,
  );
  const parsed = customQuerySchema.safeParse(view.query);
  if (!parsed.success || validateCustomQuery(parsed.data))
    throw new HTTPException(422, { message: "saved_view_not_runnable" });
  return {
    kind: "custom",
    name: view.name,
    query: parsed.data,
    chartType: (CUSTOM_CHART_TYPES as readonly string[]).includes(
      widget.chartType,
    )
      ? (widget.chartType as (typeof CUSTOM_CHART_TYPES)[number])
      : "bar",
  };
}

router
  .openapi(listReportsRoute, async (c) => {
    const workspaceId = c.get("workspaceId");
    const caps = await callerCaps(c);
    const features = new Map(
      (await listWorkspaceFeatures(workspaceId)).map((entry) => [
        entry.key,
        entry.enabled,
      ]),
    );
    return c.json(
      {
        data: REPORTS.map((report) => ({
          key: report.key,
          title: report.title,
          category: report.category,
          tier: 1 as const,
          live: report.live === true,
          available: report.feature
            ? features.get(report.feature) === true
            : true,
          options: (report.options ?? []).map((option) => ({
            key: option.key,
            values: option.values,
          })),
        })),
        meta: {
          scope: caps.readAll ? ("all" as const) : ("reach" as const),
          canExport: await holds(c, "report:export"),
          canSeeRates: caps.showRates,
          canManageWorkspaceDashboards: await holds(
            c,
            "workspace:manage_settings",
          ),
        },
      },
      200,
    );
  })
  .openapi(reportRoute, async (c) => {
    const def = definitionOf(c.req.valid("param").key);
    const query = c.req.valid("query");
    const now = new Date();
    const window = windowOrThrow(query, now);
    const identity = await identityOf(c);
    try {
      const envelope = await runReport({
        def,
        workspaceId: c.get("workspaceId"),
        identity,
        caps: await callerCaps(c),
        window,
        filters: filtersOf(query),
        options: queryOptions(query),
        now,
      });
      return c.json(reportEnvelopeSchema.parse(envelope), 200);
    } catch (error) {
      return disabled(error);
    }
  })
  .openapi(drillRoute, async (c) => {
    const def = definitionOf(c.req.valid("param").key);
    const drill = drillOf(def);
    if (!drill) return c.json({ data: [] }, 200);
    const query = c.req.valid("query");
    const now = new Date();
    const window = windowOrThrow(query, now);
    const workspaceId = c.get("workspaceId");
    if (
      def.feature &&
      !(await workspaceFeatureEnabled(workspaceId, def.feature))
    )
      throw new HTTPException(409, { message: "feature_disabled" });
    const identity = await identityOf(c);
    const caps = await callerCaps(c);
    const ctx = buildContext({
      workspaceId,
      identity,
      readAll: caps.readAll,
      showRates: caps.showRates,
      readAnyTime: caps.readAnyTime,
      now,
      window,
      filters: filtersOf(query),
      options: Object.fromEntries(
        Object.entries(queryOptions(query)).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    });
    const items = await drill(ctx, query.handle ?? null, query.limit);
    return c.json({ data: items }, 200);
  })
  .openapi(customExportRoute, async (c) => {
    const body = c.req.valid("json");
    return runExport(c, c.get("workspaceId"), {
      kind: "custom",
      name: body.name || "Custom report",
      query: body.query,
      chartType: body.chartType,
    });
  })
  .openapi(customItemsRoute, async (c) => {
    const body = c.req.valid("json");
    const problem = validateCustomQuery(body.query);
    if (problem) throw new HTTPException(422, { message: problem });
    const now = new Date();
    const items = await drillCustomReport({
      query: body.query,
      handle: body.handle ?? null,
      limit: body.limit,
      workspaceId: c.get("workspaceId"),
      identity: await identityOf(c),
      caps: await callerCaps(c),
      window: windowOrThrow(customWindowInput(body.query), now),
      now,
    });
    return c.json({ data: items }, 200);
  })
  .openapi(exportRoute, async (c) => {
    const key = c.req.valid("param").key;
    definitionOf(key);
    const body = c.req.valid("json");
    return runExport(c, c.get("workspaceId"), {
      kind: "report",
      key,
      window: { window: body.window, from: body.from, to: body.to },
      filters: filtersOf(body),
      options: queryOptions(body),
    });
  })
  .openapi(listExportsRoute, async (c) => {
    const identity = await identityOf(c);
    const rows = await listExports(c.get("workspaceId"), identity.personId);
    return c.json({ data: rows.map(exportDto) }, 200);
  })
  .openapi(getExportRoute, async (c) => {
    const row = await getExport(c.req.valid("param").id);
    if (!row) throw new HTTPException(404, { message: "Export not found" });
    return c.json({ data: exportDto(row) }, 200);
  })
  .openapi(downloadExportRoute, async (c) => {
    const row = await getExport(c.req.valid("param").id);
    if (!row) throw new HTTPException(404, { message: "Export not found" });
    if (row.status === "expired")
      throw new HTTPException(410, { message: "expired" });
    if (row.status !== "ready" || row.content === null)
      throw new HTTPException(409, {
        message: row.status === "failed" ? "failed" : "not_ready",
      });
    if (row.expiresAt && row.expiresAt.getTime() < Date.now())
      throw new HTTPException(410, { message: "expired" });
    // The file was rendered under the caps stored on the row (what the requester held at render
    // time). Reach and rate visibility are not re-evaluated against the stored rows, so a caller
    // who has lost a wider right since is refused the file instead (TC-11 for rates).
    const held = await callerCaps(c);
    const rendered = row.caps as { readAll?: boolean; readAnyTime?: boolean };
    if (row.ratesIncluded && !held.showRates)
      throw new HTTPException(403, { message: "rates_revoked" });
    if (
      (rendered.readAll === true && !held.readAll) ||
      (rendered.readAnyTime === true && !held.readAnyTime)
    )
      throw new HTTPException(403, { message: "reach_revoked" });
    // R7-05: a file rendered under project reach is refused once the requester has lost any
    // project it covered, within the 24 hour retention as much as after it.
    if (await exportReachLost(row, await identityOf(c)))
      throw new HTTPException(403, { message: "reach_revoked" });
    await db.transaction((tx) =>
      auditReport(tx, {
        action: "report.exported",
        workspaceId: row.workspaceId,
        entityType: row.kind === "report" ? "report" : "report_export",
        entityId: row.reportKey ?? row.id,
        actor: actorOf(c),
        after: {
          report: row.reportKey ?? "custom",
          format: "csv",
          rows: row.rowCount,
          via: "async",
          exportId: row.id,
          truncated: row.truncated,
        },
      }),
    );
    await recordDownload(row.id);
    return c.body(row.content, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${row.filename ?? "report.csv"}"`,
      "cache-control": "no-store",
    });
  })
  .openapi(customPreviewRoute, async (c) => {
    const body = c.req.valid("json");
    const problem = validateCustomQuery(body.query);
    if (problem) throw new HTTPException(422, { message: problem });
    const now = new Date();
    const window = windowOrThrow(customWindowInput(body.query), now);
    const identity = await identityOf(c);
    const envelope = await runCustomReport({
      title: body.name || "Custom report",
      query: body.query,
      workspaceId: c.get("workspaceId"),
      identity,
      caps: await callerCaps(c),
      window,
      chartType: body.chartType,
      now,
    });
    return c.json(reportEnvelopeSchema.parse(envelope), 200);
  })
  .openapi(listDashboardsRoute, async (c) => {
    const identity = await identityOf(c);
    const workspaceId = c.get("workspaceId");
    await ensureDefaultDashboard(workspaceId, identity.personId, actorOf(c));
    const canManage = await holds(c, "workspace:manage_settings");
    const rows = await listDashboards(workspaceId, identity.personId);
    return c.json(
      {
        data: rows.map((row) =>
          dashboardDto(row, identity.personId, canManage, row.widgetCount),
        ),
        meta: { canManageWorkspaceDashboards: canManage },
      },
      200,
    );
  })
  .openapi(createDashboardRoute, async (c) => {
    const body = c.req.valid("json");
    const identity = await identityOf(c);
    const canManage = await holds(c, "workspace:manage_settings");
    if (body.scope === "workspace" && !canManage)
      throw new HTTPException(403, { message: "Insufficient permissions" });
    const widgets = body.widgets ?? [];
    await checkWidgets(widgets, identity.personId, c.get("userId") as string);
    try {
      const row = await createDashboard({
        workspaceId: body.workspaceId,
        personId: identity.personId,
        name: body.name,
        scope: body.scope,
        isDefault: body.isDefault === true,
        widgets,
        actor: actorOf(c),
      });
      return c.json(await detail(row, identity.personId, canManage), 201);
    } catch (error) {
      if (error instanceof DashboardNameTakenError)
        throw new HTTPException(409, { message: "name_taken" });
      if (error instanceof DashboardLimitError)
        throw new HTTPException(422, { message: "dashboard_limit" });
      throw error;
    }
  })
  .openapi(getDashboardRoute, async (c) => {
    const identity = await identityOf(c);
    const row = await getDashboard(
      c.get("workspaceId"),
      identity.personId,
      c.req.valid("param").id,
    );
    if (!row) throw new HTTPException(404, { message: "Dashboard not found" });
    return c.json(
      await detail(
        row,
        identity.personId,
        await holds(c, "workspace:manage_settings"),
      ),
      200,
    );
  })
  .openapi(updateDashboardRoute, async (c) => {
    const identity = await identityOf(c);
    const workspaceId = c.get("workspaceId");
    const id = c.req.valid("param").id;
    const body = c.req.valid("json");
    const row = await getDashboard(workspaceId, identity.personId, id);
    if (!row) throw new HTTPException(404, { message: "Dashboard not found" });
    const canManage = await holds(c, "workspace:manage_settings");
    const allowed =
      row.scope === "workspace" ? canManage : row.ownerId === identity.personId;
    if (!allowed)
      throw new HTTPException(403, { message: "Insufficient permissions" });
    if (body.widgets)
      await checkWidgets(
        body.widgets,
        identity.personId,
        c.get("userId") as string,
      );
    try {
      const updated = await updateDashboard({
        workspaceId,
        id,
        version: body.version,
        name: body.name,
        isDefault: body.isDefault,
        widgets: body.widgets,
        actor: actorOf(c),
      });
      if (!updated)
        throw new HTTPException(404, { message: "Dashboard not found" });
      return c.json(await detail(updated, identity.personId, canManage), 200);
    } catch (error) {
      if (error instanceof DashboardVersionConflictError)
        throw new HTTPException(409, { message: "version_conflict" });
      if (error instanceof DashboardNameTakenError)
        throw new HTTPException(409, { message: "name_taken" });
      throw error;
    }
  })
  .openapi(deleteDashboardRoute, async (c) => {
    const identity = await identityOf(c);
    const workspaceId = c.get("workspaceId");
    const id = c.req.valid("param").id;
    const row = await getDashboard(workspaceId, identity.personId, id);
    if (!row) throw new HTTPException(404, { message: "Dashboard not found" });
    const allowed =
      row.scope === "workspace"
        ? await holds(c, "workspace:manage_settings")
        : row.ownerId === identity.personId;
    if (!allowed)
      throw new HTTPException(403, { message: "Insufficient permissions" });
    const pending = await requestRegisteredDeletion(c, {
      routeKey: DASHBOARD_DELETION_ROUTE,
      targetType: "dashboard",
      id,
      workspaceId,
    });
    return c.json(pending, 202);
  })
  .openapi(widgetDataRoute, async (c) => {
    const identity = await identityOf(c);
    const workspaceId = c.get("workspaceId");
    const { id, wid } = c.req.valid("param");
    const dashboard = await getDashboard(workspaceId, identity.personId, id);
    if (!dashboard)
      throw new HTTPException(404, { message: "Dashboard not found" });
    const widget = await getWidget(id, wid);
    if (!widget) throw new HTTPException(404, { message: "Widget not found" });
    const now = new Date();
    const filters = widget.filters ?? {};
    const caps = await callerCaps(c);
    if (widget.reportKey) {
      const def = definitionOf(widget.reportKey);
      const resolved = resolveWindow(widgetWindowInput(filters), now);
      const window = resolved.ok ? resolved.window : windowOrThrow({}, now);
      const text = (key: string) =>
        typeof filters[key] === "string" ? (filters[key] as string) : undefined;
      try {
        const envelope = await runReport({
          def,
          workspaceId,
          identity,
          caps,
          window,
          filters: cleanFilters(filters),
          options: {
            by: text("by"),
            metric: text("metric"),
            days: text("days"),
            cycle: text("cycle"),
          },
          now,
        });
        return c.json(reportEnvelopeSchema.parse(envelope), 200);
      } catch (error) {
        return disabled(error);
      }
    }
    // A saved tier 2/3 view: its own query, run through the same reach as any report.
    const view = await getView(
      widget.savedViewId ?? "",
      identity.personId,
      c.get("userId") as string,
    );
    const parsed = customQuerySchema.safeParse(view.query);
    if (!parsed.success || validateCustomQuery(parsed.data))
      throw new HTTPException(422, { message: "saved_view_not_runnable" });
    const window = windowOrThrow(customWindowInput(parsed.data), now);
    const envelope = await runCustomReport({
      title: view.name,
      query: parsed.data,
      workspaceId,
      identity,
      caps,
      window,
      chartType: (CUSTOM_CHART_TYPES as readonly string[]).includes(
        widget.chartType,
      )
        ? widget.chartType
        : "bar",
      now,
    });
    return c.json(reportEnvelopeSchema.parse(envelope), 200);
  })
  .openapi(widgetItemsRoute, async (c) => {
    const identity = await identityOf(c);
    const workspaceId = c.get("workspaceId");
    const { id, wid } = c.req.valid("param");
    const query = c.req.valid("query");
    const dashboard = await getDashboard(workspaceId, identity.personId, id);
    if (!dashboard)
      throw new HTTPException(404, { message: "Dashboard not found" });
    const widget = await getWidget(id, wid);
    if (!widget) throw new HTTPException(404, { message: "Widget not found" });
    const now = new Date();
    const caps = await callerCaps(c);
    const spec = await widgetSpec(c, widget, identity.personId);
    if (spec.kind === "custom") {
      const items = await drillCustomReport({
        query: spec.query,
        handle: query.handle ?? null,
        limit: query.limit,
        workspaceId,
        identity,
        caps,
        window: windowOrThrow(customWindowInput(spec.query), now),
        now,
      });
      return c.json({ data: items }, 200);
    }
    const def = definitionOf(spec.key);
    const drill = drillOf(def);
    if (!drill) return c.json({ data: [] }, 200);
    if (
      def.feature &&
      !(await workspaceFeatureEnabled(workspaceId, def.feature))
    )
      throw new HTTPException(409, { message: "feature_disabled" });
    const ctx = buildContext({
      workspaceId,
      identity,
      readAll: caps.readAll,
      showRates: caps.showRates,
      readAnyTime: caps.readAnyTime,
      now,
      window: windowOrThrow(spec.window, now),
      filters: spec.filters,
      options: Object.fromEntries(
        Object.entries(spec.options).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    });
    return c.json(
      { data: await drill(ctx, query.handle ?? null, query.limit) },
      200,
    );
  })
  .openapi(widgetExportRoute, async (c) => {
    const identity = await identityOf(c);
    const workspaceId = c.get("workspaceId");
    const { id, wid } = c.req.valid("param");
    const dashboard = await getDashboard(workspaceId, identity.personId, id);
    if (!dashboard)
      throw new HTTPException(404, { message: "Dashboard not found" });
    const widget = await getWidget(id, wid);
    if (!widget) throw new HTTPException(404, { message: "Widget not found" });
    return runExport(
      c,
      workspaceId,
      await widgetSpec(c, widget, identity.personId),
    );
  });

export default router;
