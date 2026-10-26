// P5 reports and dashboards tables (owned by the reports lane). Re-exported nowhere: import from this file directly.
// Mirrors apps/api/drizzle/0152_p5_reports_dashboards.sql, which is the hand-written source of truth.
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  organisationTable,
  personTable,
  projectTable,
  savedViewTable,
  userTable,
  workspaceTable,
} from "./schema";

const tz = { mode: "date", withTimezone: true } as const;

/**
 * RP-13/RP-14: a grid of widgets. `scope = 'personal'` belongs to one person (`owner_id`); a
 * `workspace` dashboard has no owner and needs `workspace:manage_settings` to write. `version`
 * guards concurrent layout saves.
 */
export const dashboardTable = pgTable(
  "dashboard",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    ownerId: text("owner_id"),
    name: text("name").notNull(),
    scope: text("scope").$type<"personal" | "workspace">().notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "dashboard_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaceTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "dashboard_owner_fk",
      columns: [table.ownerId],
      foreignColumns: [personTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    unique("dashboard_workspace_id_id_unique").on(table.workspaceId, table.id),
    uniqueIndex("dashboard_scope_name_unique").using(
      "btree",
      table.workspaceId,
      sql`COALESCE(${table.ownerId}, '')`,
      sql`lower(${table.name})`,
    ),
    uniqueIndex("dashboard_one_default_per_workspace")
      .on(table.workspaceId)
      .where(sql`${table.isDefault}`),
    index("dashboard_owner_idx").on(table.ownerId),
    check(
      "dashboard_scope_allowed",
      sql`${table.scope} IN ('personal', 'workspace')`,
    ),
    check(
      "dashboard_scope_owner",
      sql`(${table.scope} = 'personal') = (${table.ownerId} IS NOT NULL)`,
    ),
    check(
      "dashboard_default_workspace_only",
      sql`NOT ${table.isDefault} OR ${table.scope} = 'workspace'`,
    ),
    check(
      "dashboard_name_length",
      sql`char_length(btrim(${table.name})) BETWEEN 1 AND 120`,
    ),
    check("dashboard_version_positive", sql`${table.version} >= 1`),
  ],
);

/**
 * RP-13/RP-15: one widget is a fixed report (`report_key`) or a saved tier 2/3 view
 * (`saved_view_id`), never both. `filters` holds the widget's own window and filters, because
 * the same report can sit on a dashboard twice with different windows. `x`/`y`/`w`/`h` are grid
 * cells on a 12-column grid.
 */
export const dashboardWidgetTable = pgTable(
  "dashboard_widget",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    dashboardId: text("dashboard_id").notNull(),
    reportKey: text("report_key"),
    savedViewId: text("saved_view_id"),
    chartType: text("chart_type")
      .$type<"bar" | "line" | "table" | "number">()
      .notNull()
      .default("bar"),
    filters: jsonb("filters")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    x: integer("x").notNull().default(0),
    y: integer("y").notNull().default(0),
    w: integer("w").notNull().default(6),
    h: integer("h").notNull().default(4),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "dashboard_widget_dashboard_fk",
      columns: [table.dashboardId],
      foreignColumns: [dashboardTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "dashboard_widget_saved_view_fk",
      columns: [table.savedViewId],
      foreignColumns: [savedViewTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("dashboard_widget_dashboard_idx").on(table.dashboardId),
    index("dashboard_widget_saved_view_idx").on(table.savedViewId),
    check(
      "dashboard_widget_source",
      sql`(${table.reportKey} IS NOT NULL) <> (${table.savedViewId} IS NOT NULL)`,
    ),
    check(
      "dashboard_widget_chart_type_allowed",
      sql`${table.chartType} IN ('bar', 'line', 'table', 'number')`,
    ),
    check(
      "dashboard_widget_grid_range",
      sql`${table.x} BETWEEN 0 AND 11 AND ${table.y} BETWEEN 0 AND 999 AND ${table.w} BETWEEN 1 AND 12 AND ${table.h} BETWEEN 1 AND 12 AND ${table.x} + ${table.w} <= 12`,
    ),
  ],
);

/**
 * RP-9: one aggregate of one metric for one closed UTC day of one project, split by the dimensions a
 * report can filter on (`priority`, `typeId`). Written by the `metrics-snapshot` job, which replaces
 * a whole workspace-day in one transaction, so the unique key only guards against a second writer.
 * Additional report families may carry opaque person dimensions and currency totals, never
 * names, comments or rate schedules. Their retention respects matching legal holds.
 */
export const metricSnapshotTable = pgTable(
  "metric_snapshot",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    periodStart: timestamp("period_start", tz).notNull(),
    periodEnd: timestamp("period_end", tz).notNull(),
    grain: text("grain").$type<"day">().notNull().default("day"),
    metricKey: text("metric_key").notNull(),
    projectId: text("project_id"),
    organisationId: text("organisation_id"),
    dimensions: jsonb("dimensions")
      .$type<Record<string, string | null>>()
      .notNull()
      .default({}),
    measures: jsonb("measures")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    computedAt: timestamp("computed_at", tz).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "metric_snapshot_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaceTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "metric_snapshot_project_fk",
      columns: [table.projectId],
      foreignColumns: [projectTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "metric_snapshot_organisation_fk",
      columns: [table.organisationId],
      foreignColumns: [organisationTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    uniqueIndex("metric_snapshot_key_unique").using(
      "btree",
      table.workspaceId,
      table.metricKey,
      table.grain,
      table.periodStart,
      sql`COALESCE(${table.projectId}, '')`,
      sql`COALESCE(${table.organisationId}, '')`,
      table.dimensions,
    ),
    index("metric_snapshot_read_idx").on(
      table.workspaceId,
      table.metricKey,
      table.grain,
      table.periodStart,
      table.projectId,
      table.organisationId,
    ),
    index("metric_snapshot_project_idx").on(table.projectId),
    index("metric_snapshot_organisation_idx")
      .on(table.organisationId)
      .where(sql`${table.organisationId} IS NOT NULL`),
    check("metric_snapshot_grain_allowed", sql`${table.grain} IN ('day')`),
    check(
      "metric_snapshot_period_order",
      sql`${table.periodEnd} > ${table.periodStart}`,
    ),
  ],
);

/** RP-9: the marker that a workspace's closed day was computed (a day with no rows may be zero or never computed). */
export const metricSnapshotDayTable = pgTable(
  "metric_snapshot_day",
  {
    workspaceId: text("workspace_id").notNull(),
    periodStart: timestamp("period_start", tz).notNull(),
    computedAt: timestamp("computed_at", tz).defaultNow().notNull(),
    // Legacy writers certify only their original three metrics. New readers must
    // require the version written after every supported fact family is complete.
    snapshotVersion: integer("snapshot_version").notNull().default(1),
  },
  (table) => [
    primaryKey({
      name: "metric_snapshot_day_workspace_id_period_start_pk",
      columns: [table.workspaceId, table.periodStart],
    }),
    foreignKey({
      name: "metric_snapshot_day_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaceTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    check(
      "metric_snapshot_day_version_positive",
      sql`${table.snapshotVersion} > 0`,
    ),
  ],
);

/**
 * RP-10: an export too large to answer inside the request. `spec` is what to run (window, filters,
 * options, or a tier 3 query); `caps` is what the requester could see when asking (the job ANDs it
 * with what they can see now). `content` is the rendered CSV until `expires_at`, then it is dropped.
 */
export const reportExportTable = pgTable(
  "report_export",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    personId: text("person_id").notNull(),
    userId: text("user_id").notNull(),
    kind: text("kind").$type<"report" | "custom">().notNull(),
    reportKey: text("report_key"),
    title: text("title").notNull(),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    // The three capability flags, plus (reach-scoped files only) `projectIds`: the projects the file covered.
    caps: jsonb("caps").$type<Record<string, boolean | string[]>>().notNull(),
    status: text("status")
      .$type<"queued" | "running" | "ready" | "failed" | "expired">()
      .notNull()
      .default("queued"),
    ratesIncluded: boolean("rates_included").notNull().default(false),
    filename: text("filename"),
    content: text("content"),
    rowCount: integer("row_count"),
    byteSize: integer("byte_size"),
    truncated: boolean("truncated").notNull().default(false),
    error: text("error"),
    downloadCount: integer("download_count").notNull().default(0),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    startedAt: timestamp("started_at", tz),
    finishedAt: timestamp("finished_at", tz),
    expiresAt: timestamp("expires_at", tz),
    downloadedAt: timestamp("downloaded_at", tz),
  },
  (table) => [
    foreignKey({
      name: "report_export_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaceTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "report_export_person_fk",
      columns: [table.personId],
      foreignColumns: [personTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "report_export_user_fk",
      columns: [table.userId],
      foreignColumns: [userTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("report_export_status_idx").on(table.status, table.createdAt),
    index("report_export_person_idx").on(table.personId, table.createdAt),
    index("report_export_workspace_idx").on(table.workspaceId),
    check(
      "report_export_kind_allowed",
      sql`${table.kind} IN ('report', 'custom')`,
    ),
    check(
      "report_export_status_allowed",
      sql`${table.status} IN ('queued', 'running', 'ready', 'failed', 'expired')`,
    ),
    check(
      "report_export_report_key",
      sql`(${table.kind} = 'report') = (${table.reportKey} IS NOT NULL)`,
    ),
  ],
);
