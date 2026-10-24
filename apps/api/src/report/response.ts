import { z } from "../openapi";

const cell = z.union([
  z.string(),
  z.number(),
  z.null(),
  z.object({ n: z.number(), needed: z.number() }),
]);

const trend = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ok"),
    direction: z.enum(["up", "down", "flat"]),
    delta: z.number(),
    previous: z.number(),
  }),
  z.object({
    status: z.literal("insufficient"),
    reason: z.literal("needs_two_periods"),
  }),
]);

const unit = z.enum(["percent", "count", "hours", "days", "score", "money"]);

export const reportFiltersSchema = z.object({
  projectId: z.string().optional(),
  organisationId: z.string().optional(),
  teamId: z.string().optional(),
  typeId: z.string().optional(),
  priority: z.string().optional(),
});

export const reportEnvelopeSchema = z.object({
  key: z.string(),
  title: z.string(),
  category: z.enum([
    "promises",
    "customers",
    "delivery",
    "people",
    "leadership",
    "agile",
    "time",
    "knowledge",
  ]),
  tier: z.literal(1),
  scope: z.object({
    kind: z.enum(["all", "reach"]),
    projectCount: z.number().int(),
  }),
  window: z.object({
    preset: z.string(),
    from: z.string(),
    to: z.string(),
    days: z.number().int(),
    live: z.boolean(),
  }),
  asOf: z.string(),
  boundary: z.literal("live"),
  filters: reportFiltersSchema,
  options: z.record(z.string(), z.string()),
  choices: z.array(
    z.object({
      key: z.string(),
      values: z.array(z.object({ value: z.string(), label: z.string() })),
      selected: z.string().nullable(),
    }),
  ),
  metrics: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      unit,
      value: z.number().nullable(),
      n: z.number(),
      needed: z.number(),
      trend: trend.optional(),
      currency: z.string().optional(),
    }),
  ),
  chart: z
    .object({
      type: z.enum(["bar", "line"]),
      unit,
      categories: z.array(z.string()),
      series: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          values: z.array(z.number().nullable()),
        }),
      ),
    })
    .nullable(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      kind: z.enum([
        "text",
        "number",
        "percent",
        "hours",
        "days",
        "date",
        "money",
        "bucket",
      ]),
    }),
  ),
  rows: z.array(z.record(z.string(), cell)),
  truncated: z.boolean(),
  empty: z
    .object({
      reason: z.enum(["no_data_in_window", "no_data"]),
      outsideWindow: z.number().int(),
      excluded: z
        .object({ count: z.number().int(), reason: z.string() })
        .nullable(),
    })
    .nullable(),
  excluded: z
    .object({ count: z.number().int(), reason: z.string() })
    .nullable(),
  notes: z.array(z.string()),
  drill: z.boolean(),
  costVisible: z.boolean(),
});

export const reportCatalogueSchema = z.object({
  data: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      category: z.string(),
      tier: z.literal(1),
      live: z.boolean(),
      available: z.boolean(),
      options: z.array(
        z.object({ key: z.string(), values: z.array(z.string()) }),
      ),
    }),
  ),
  meta: z.object({
    scope: z.enum(["all", "reach"]),
    canExport: z.boolean(),
    canSeeRates: z.boolean(),
    canManageWorkspaceDashboards: z.boolean(),
  }),
});

export const drillResponseSchema = z.object({
  data: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      projectKey: z.string().nullable(),
      state: z.string().nullable(),
      priority: z.string().nullable(),
    }),
  ),
});

export const widgetSchema = z.object({
  id: z.string(),
  reportKey: z.string().nullable(),
  savedViewId: z.string().nullable(),
  chartType: z.enum(["bar", "line", "table", "number"]),
  filters: z.record(z.string(), z.unknown()),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
});

export const dashboardSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  ownerId: z.string().nullable(),
  name: z.string(),
  scope: z.enum(["personal", "workspace"]),
  isDefault: z.boolean(),
  version: z.number().int(),
  canEdit: z.boolean(),
  widgetCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const dashboardDetailSchema = dashboardSchema.extend({
  widgets: z.array(widgetSchema),
});

export const dashboardListSchema = z.object({
  data: z.array(dashboardSchema),
  meta: z.object({ canManageWorkspaceDashboards: z.boolean() }),
});
