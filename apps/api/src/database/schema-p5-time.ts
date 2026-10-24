// P5 time and cost tables (owned by the time lane). Re-exported nowhere: import from this file directly.
// Mirrors apps/api/drizzle/0149_p5_time_and_cost.sql, which is the hand-written source of truth.
//
// The legacy Kaneo table is `taskTimeEntryTable` in schema.ts (SQL `task_time_entry`); the
// canonical work-item table below keeps the name `time_entry` (data-model.md section 9).
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  personTable,
  projectTable,
  workItemTable,
  workspaceTable,
} from "./schema";

const tz = { mode: "date", withTimezone: true } as const;

/** TC-2: the activity types a time entry must carry (Development, Support, Meeting, Travel, ...). */
export const timeActivityTable = pgTable(
  "time_activity",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull().default(0),
    archivedAt: timestamp("archived_at", tz),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "time_activity_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaceTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    unique("time_activity_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    unique("time_activity_workspace_name_unique").on(
      table.workspaceId,
      table.name,
    ),
    check("time_activity_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ],
);

/**
 * TC-1..TC-7: a person's integer minutes on a date against a work item. `rate_minor`/`currency`
 * are the hourly rate snapshotted when the entry was created or the timer stopped (owner
 * decision D4); null means unpriced. `work_item_id` is nulled when the item is deleted, the row
 * stays on its project.
 */
export const timeEntryTable = pgTable(
  "time_entry",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    workItemId: text("work_item_id"),
    personId: text("person_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    minutes: integer("minutes").notNull(),
    activityId: text("activity_id").notNull(),
    description: text("description"),
    billable: boolean("billable").notNull(),
    rateMinor: bigint("rate_minor", { mode: "number" }),
    currency: text("currency"),
    source: text("source")
      .$type<"manual" | "timer" | "timer_capped">()
      .notNull()
      .default("manual"),
    needsReview: boolean("needs_review").notNull().default(false),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz)
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "time_entry_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "time_entry_work_item_fk",
      columns: [table.workItemId],
      foreignColumns: [workItemTable.id],
    })
      .onDelete("set null")
      .onUpdate("cascade"),
    foreignKey({
      name: "time_entry_person_fk",
      columns: [table.personId],
      foreignColumns: [personTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "time_entry_workspace_activity_fk",
      columns: [table.workspaceId, table.activityId],
      foreignColumns: [timeActivityTable.workspaceId, timeActivityTable.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    index("time_entry_person_id_date_idx").on(table.personId, table.date),
    index("time_entry_work_item_id_idx").on(table.workItemId),
    index("time_entry_project_id_date_idx").on(table.projectId, table.date),
    index("time_entry_workspace_id_date_idx").on(table.workspaceId, table.date),
    index("time_entry_activity_id_idx").on(table.activityId),
    check(
      "time_entry_minutes_range",
      sql`${table.minutes} > 0 AND ${table.minutes} <= 1440`,
    ),
    check(
      "time_entry_rate_pair",
      sql`(${table.rateMinor} IS NULL) = (${table.currency} IS NULL)`,
    ),
    check(
      "time_entry_rate_nonnegative",
      sql`${table.rateMinor} IS NULL OR ${table.rateMinor} >= 0`,
    ),
    check(
      "time_entry_source_allowed",
      sql`${table.source} IN ('manual', 'timer', 'timer_capped')`,
    ),
  ],
);

/** TC-6: at most one running timer per person (the primary key), capped at 12 h on stop and by the sweeper. */
export const runningTimerTable = pgTable(
  "running_timer",
  {
    personId: text("person_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    activityId: text("activity_id").notNull(),
    description: text("description"),
    billable: boolean("billable").notNull(),
    startedAt: timestamp("started_at", tz).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "running_timer_person_fk",
      columns: [table.personId],
      foreignColumns: [personTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "running_timer_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "running_timer_work_item_fk",
      columns: [table.workItemId],
      foreignColumns: [workItemTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "running_timer_workspace_activity_fk",
      columns: [table.workspaceId, table.activityId],
      foreignColumns: [timeActivityTable.workspaceId, timeActivityTable.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    index("running_timer_started_at_idx").on(table.startedAt),
  ],
);

/** TC-8..TC-10: a person's hourly rate, optionally per project, effective from a date. */
export const hourlyRateTable = pgTable(
  "hourly_rate",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    personId: text("person_id").notNull(),
    projectId: text("project_id"),
    rateMinor: bigint("rate_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "hourly_rate_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaceTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "hourly_rate_person_fk",
      columns: [table.personId],
      foreignColumns: [personTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "hourly_rate_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    uniqueIndex("hourly_rate_person_project_effective_unique")
      .on(table.personId, table.projectId, table.effectiveFrom)
      .where(sql`${table.projectId} IS NOT NULL`),
    uniqueIndex("hourly_rate_person_default_effective_unique")
      .on(table.personId, table.effectiveFrom)
      .where(sql`${table.projectId} IS NULL`),
    index("hourly_rate_workspace_id_idx").on(table.workspaceId),
    check("hourly_rate_rate_nonnegative", sql`${table.rateMinor} >= 0`),
    check("hourly_rate_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/** TC-15: a project budget with a planned amount, currency and period. */
export const budgetTable = pgTable(
  "budget",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    name: text("name").notNull(),
    plannedAmountMinor: bigint("planned_amount_minor", {
      mode: "number",
    }).notNull(),
    currency: text("currency").notNull(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz)
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "budget_workspace_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    index("budget_project_id_idx").on(table.projectId),
    check("budget_planned_nonnegative", sql`${table.plannedAmountMinor} >= 0`),
    check("budget_currency_format", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "budget_period_order",
      sql`${table.periodEnd} >= ${table.periodStart}`,
    ),
    check("budget_name_not_blank", sql`btrim(${table.name}) <> ''`),
  ],
);
