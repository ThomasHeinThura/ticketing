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
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { personTable, savedViewTable, workspaceTable } from "./schema";

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
