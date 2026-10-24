import { z } from "../openapi";
import { CUSTOM_CHART_TYPES, customQuerySchema } from "./custom";

export const workspaceIdQuery = z.object({ workspaceId: z.string().min(1) });
export const reportKeyParam = z.object({ key: z.string().min(1).max(80) });
export const dashboardIdParam = z.object({ id: z.string().min(1).max(80) });
export const widgetParam = z.object({
  id: z.string().min(1).max(80),
  wid: z.string().min(1).max(80),
});

const short = z.string().min(1).max(200);

/** RP-7/RP-8: the whole filter state is query parameters, so a link reproduces the screen. */
export const reportQuery = z.object({
  workspaceId: z.string().min(1),
  window: z.enum(["7", "30", "60", "90", "custom"]).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  projectId: short.optional(),
  organisationId: short.optional(),
  teamId: short.optional(),
  typeId: short.optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  by: short.optional(),
  metric: z.enum(["resolution", "first_response"]).optional(),
  days: z.enum(["7", "14", "30", "60", "90"]).optional(),
  cycle: short.optional(),
});

export const drillQuery = reportQuery.extend({
  handle: short.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const exportBody = z.object({
  workspaceId: z.string().min(1),
  window: z.enum(["7", "30", "60", "90", "custom"]).optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  projectId: short.optional(),
  organisationId: short.optional(),
  teamId: short.optional(),
  typeId: short.optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  by: short.optional(),
  metric: z.enum(["resolution", "first_response"]).optional(),
  days: z.enum(["7", "14", "30", "60", "90"]).optional(),
  cycle: short.optional(),
});

export const customPreviewBody = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().max(200).optional(),
  query: customQuerySchema,
  chartType: z.enum(CUSTOM_CHART_TYPES).default("bar"),
});

export const MAX_WIDGETS = 20;
export const MAX_PERSONAL_DASHBOARDS = 20;
export const MAX_WORKSPACE_DASHBOARDS = 20;

const widgetFilters = z
  .object({
    window: z.enum(["7", "30", "60", "90", "custom"]).optional(),
    from: z.string().max(10).optional(),
    to: z.string().max(10).optional(),
    projectId: short.optional(),
    organisationId: short.optional(),
    teamId: short.optional(),
    typeId: short.optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
    by: short.optional(),
    metric: z.enum(["resolution", "first_response"]).optional(),
    days: z.enum(["7", "14", "30", "60", "90"]).optional(),
    cycle: short.optional(),
  })
  .strict();

export const widgetInput = z
  .object({
    /** Present on an existing widget; a new one has none. */
    id: z.string().min(1).max(80).optional(),
    reportKey: z.string().min(1).max(80).nullable().optional(),
    savedViewId: z.string().min(1).max(80).nullable().optional(),
    chartType: z.enum(["bar", "line", "table", "number"]).default("bar"),
    filters: widgetFilters.default({}),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(999),
    w: z.number().int().min(1).max(12),
    h: z.number().int().min(1).max(12),
  })
  .refine(
    (widget) => Boolean(widget.reportKey) !== Boolean(widget.savedViewId),
    {
      message: "A widget is a report or a saved view, not both",
    },
  )
  .refine((widget) => widget.x + widget.w <= 12, {
    message: "A widget must fit the 12-column grid",
  });

export const createDashboardBody = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  scope: z.enum(["personal", "workspace"]).default("personal"),
  isDefault: z.boolean().optional(),
  widgets: z.array(widgetInput).max(MAX_WIDGETS).optional(),
});

export const updateDashboardBody = z
  .object({
    /** Concurrency: the dashboard version the client edited. */
    version: z.number().int().min(1),
    name: z.string().trim().min(1).max(120).optional(),
    isDefault: z.boolean().optional(),
    widgets: z.array(widgetInput).max(MAX_WIDGETS).optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.isDefault !== undefined ||
      body.widgets !== undefined,
    { message: "Provide at least one field to change" },
  );
