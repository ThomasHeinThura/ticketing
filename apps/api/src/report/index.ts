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
import { workspaceFeatureEnabled } from "./feature";
import {
  actorOf,
  callerCaps,
  dashboardReach,
  holds,
  identityOf,
  requireReports,
  staffOnly,
} from "./http";
import { type ReportWindow, resolveWindow } from "./logic";
import { reportToCsv } from "./present";
import { REPORTS, reportByKey } from "./registry";
import {
  dashboardDetailSchema,
  dashboardListSchema,
  drillResponseSchema,
  reportCatalogueSchema,
  reportEnvelopeSchema,
} from "./response";
import { ReportFeatureDisabledError, runReport } from "./run";
import {
  createDashboardBody,
  customPreviewBody,
  dashboardIdParam,
  drillQuery,
  exportBody,
  reportKeyParam,
  reportQuery,
  updateDashboardBody,
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

const exportRoute = createRoute({
  method: "post",
  path: "/reports/{key}/export",
  operationId: "exportReport",
  tags: ["Reports"],
  summary: "Export a report as CSV",
  description:
    "Respects the filters and the caller's reach, carries no rate data without time_entry:manage_rates, neutralises spreadsheet formulas, and is audited (report.exported).",
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
  responses: {
    200: {
      description: "CSV",
      content: { "text/csv": { schema: reportKeyParam.shape.key } },
    },
    403: errorResponse("Not staff, or missing report:export"),
    404: errorResponse("Unknown report"),
    409: errorResponse("Feature off"),
    422: errorResponse("Invalid window"),
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
    if (!def.drillItems) return c.json({ data: [] }, 200);
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
    const items = await def.drillItems(ctx, query.handle ?? null, query.limit);
    return c.json({ data: items }, 200);
  })
  .openapi(exportRoute, async (c) => {
    const def = definitionOf(c.req.valid("param").key);
    const body = c.req.valid("json");
    const now = new Date();
    const window = windowOrThrow(body, now);
    const identity = await identityOf(c);
    const caps = await callerCaps(c);
    let envelope: Awaited<ReturnType<typeof runReport>>;
    try {
      envelope = await runReport({
        def,
        workspaceId: c.get("workspaceId"),
        identity,
        caps,
        window,
        filters: filtersOf(body),
        options: queryOptions(body),
        now,
      });
    } catch (error) {
      return disabled(error);
    }
    const csv = reportToCsv(envelope);
    // The audit row records what left and under which filters, never a rate or cost (TC-11).
    await db.transaction((tx) =>
      auditReport(tx, {
        action: "report.exported",
        workspaceId: c.get("workspaceId"),
        entityType: "report",
        entityId: def.key,
        actor: actorOf(c),
        after: {
          report: def.key,
          format: "csv",
          rows: envelope.rows.length,
          scope: envelope.scope.kind,
          window: envelope.window,
          filters: envelope.filters,
          options: envelope.options,
        },
      }),
    );
    return c.body(csv, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${def.key}-${now.toISOString().slice(0, 10)}.csv"`,
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
  });

export default router;
