// P5 agile tables (owned by the agile lane). Re-exported nowhere: import from this file directly.
// Mirrors apps/api/drizzle/0148_p5_agile_planning.sql, which is the hand-written source of truth.
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { personTable, projectTable, stateTable } from "./schema";

/**
 * CY-1..CY-3. Status (`upcoming`/`active`/`completed`) is NOT a column: only `completed_at` (the
 * completion action) is stored and the status is derived from it plus the dates, so it cannot be
 * set by hand. The no-overlap rule (CY-2) is enforced by the application under a project row lock.
 */
export const cycleTable = pgTable(
  "cycle",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }).notNull(),
    completedAt: timestamp("completed_at", {
      mode: "date",
      withTimezone: true,
    }),
    completedBy: text("completed_by"),
    createdBy: text("created_by"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "cycle_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    }).onDelete("cascade"),
    unique("cycle_project_id_id_unique").on(table.projectId, table.id),
    unique("cycle_workspace_id_id_unique").on(table.workspaceId, table.id),
    index("cycle_project_start_idx").on(table.projectId, table.startDate),
    check(
      "cycle_dates_ordered",
      sql.raw('"cycle"."end_date" >= "cycle"."start_date"'),
    ),
    check("cycle_version_positive", sql.raw('"cycle"."version" >= 1')),
  ],
);

/** CY-8: the append-only scope log. One row per add or remove. */
export const cycleScopeEventTable = pgTable(
  "cycle_scope_event",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    cycleId: text("cycle_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    kind: text("kind").notNull(),
    at: timestamp("at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    actorId: text("actor_id"),
    afterStart: boolean("after_start").notNull().default(false),
    retrospective: boolean("retrospective").notNull().default(false),
  },
  (table) => [
    foreignKey({
      name: "cycle_scope_event_cycle_id_cycle_id_fk",
      columns: [table.cycleId],
      foreignColumns: [cycleTable.id],
    }).onDelete("cascade"),
    index("cycle_scope_event_cycle_at_idx").on(table.cycleId, table.at),
    index("cycle_scope_event_work_item_idx").on(table.workItemId),
    check(
      "cycle_scope_event_kind_allowed",
      sql.raw(
        "\"cycle_scope_event\".\"kind\" IN ('added', 'removed', 'rolled_over')",
      ),
    ),
  ],
);

/** CY-9: the frozen completion snapshot velocity reads (a daily snapshot job is not built). */
export const cycleSnapshotTable = pgTable(
  "cycle_snapshot",
  {
    cycleId: text("cycle_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    unit: text("unit").notNull(),
    scopePoints: numeric("scope_points", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    completedPoints: numeric("completed_points", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    itemCount: integer("item_count").notNull().default(0),
    completedCount: integer("completed_count").notNull().default(0),
    unestimatedCount: integer("unestimated_count").notNull().default(0),
    summary: jsonb("summary"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "cycle_snapshot_cycle_id_date_pk",
      columns: [table.cycleId, table.date],
    }),
    foreignKey({
      name: "cycle_snapshot_cycle_id_cycle_id_fk",
      columns: [table.cycleId],
      foreignColumns: [cycleTable.id],
    }).onDelete("cascade"),
    check(
      "cycle_snapshot_unit_allowed",
      sql.raw("\"cycle_snapshot\".\"unit\" IN ('points', 'time', 'count')"),
    ),
  ],
);

/** MO-1..MO-3. */
export const moduleTable = pgTable(
  "module",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    leadId: text("lead_id"),
    state: text("state").notNull().default("planned"),
    targetDate: date("target_date", { mode: "string" }),
    createdBy: text("created_by"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "module_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "module_lead_id_person_id_fk",
      columns: [table.leadId],
      foreignColumns: [personTable.id],
      // A purged organisation or erased person must not be blocked by a module they lead.
    }).onDelete("set null"),
    unique("module_project_id_id_unique").on(table.projectId, table.id),
    unique("module_workspace_id_id_unique").on(table.workspaceId, table.id),
    index("module_project_idx").on(table.projectId),
    check(
      "module_state_allowed",
      sql.raw(
        "\"module\".\"state\" IN ('backlog', 'planned', 'in_progress', 'paused', 'completed', 'cancelled')",
      ),
    ),
    check("module_version_positive", sql.raw('"module"."version" >= 1')),
  ],
);

/** ES-1: at most one active estimate system per project. */
export const estimateTable = pgTable(
  "estimate",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    system: text("system").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    deactivatedAt: timestamp("deactivated_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
  (table) => [
    foreignKey({
      name: "estimate_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    }).onDelete("cascade"),
    unique("estimate_project_id_id_unique").on(table.projectId, table.id),
    uniqueIndex("estimate_project_active_unique")
      .on(table.projectId)
      .where(sql.raw('"estimate"."active"')),
    check(
      "estimate_system_allowed",
      sql.raw("\"estimate\".\"system\" IN ('points', 'categories', 'time')"),
    ),
  ],
);

/**
 * ES-2: work items reference a point row, never a raw number, so renaming or rescaling the system
 * does not rewrite history. `weight` is the summable size (points; minutes for `time`; null for
 * `categories`, which only count).
 */
export const estimatePointTable = pgTable(
  "estimate_point",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    estimateId: text("estimate_id").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    weight: numeric("weight", { precision: 14, scale: 2 }),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", { mode: "date", withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "estimate_point_estimate_id_estimate_id_fk",
      columns: [table.estimateId],
      foreignColumns: [estimateTable.id],
    }).onDelete("cascade"),
    unique("estimate_point_estimate_id_key_unique").on(
      table.estimateId,
      table.key,
    ),
    index("estimate_point_estimate_position_idx").on(
      table.estimateId,
      table.position,
    ),
  ],
);

/** Records a system or scale change so a burndown can note the discontinuity instead of hiding it. */
export const estimateChangeTable = pgTable(
  "estimate_change",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    kind: text("kind").notNull(),
    fromSystem: text("from_system"),
    toSystem: text("to_system"),
    mappedCount: integer("mapped_count").notNull().default(0),
    clearedCount: integer("cleared_count").notNull().default(0),
    actorId: text("actor_id"),
    changedAt: timestamp("changed_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "estimate_change_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    }).onDelete("cascade"),
    index("estimate_change_project_idx").on(table.projectId, table.changedAt),
    check(
      "estimate_change_kind_allowed",
      sql.raw("\"estimate_change\".\"kind\" IN ('system', 'scale')"),
    ),
  ],
);

/** CY-6: the project's incomplete-item policy for cycle completion. */
export const projectAgileSettingTable = pgTable(
  "project_agile_setting",
  {
    projectId: text("project_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    cycleIncompletePolicy: text("cycle_incomplete_policy")
      .notNull()
      .default("backlog"),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "project_agile_setting_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    }).onDelete("cascade"),
    check(
      "project_agile_setting_policy_allowed",
      sql.raw(
        "\"project_agile_setting\".\"cycle_incomplete_policy\" IN ('next_cycle', 'backlog', 'leave')",
      ),
    ),
  ],
);

/** VW-12: an optional work-in-progress limit per board column (a column is a project state). */
export const stateWipLimitTable = pgTable(
  "state_wip_limit",
  {
    stateId: text("state_id").primaryKey(),
    projectId: text("project_id").notNull(),
    wipLimit: integer("wip_limit").notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "state_wip_limit_project_state_fk",
      columns: [table.projectId, table.stateId],
      foreignColumns: [stateTable.projectId, stateTable.id],
    }).onDelete("cascade"),
    check(
      "state_wip_limit_range",
      sql.raw('"state_wip_limit"."wip_limit" BETWEEN 1 AND 1000'),
    ),
  ],
);
