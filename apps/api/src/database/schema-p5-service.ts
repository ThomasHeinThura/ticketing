// P5 service-management tables (owned by the service lane). Re-exported nowhere: import from this file directly.
// Mirrors apps/api/drizzle/0151_p5_service_management.sql, which is the hand-written source of truth.
//
// SQL-only (existing populated tables, constraints added NOT VALID in 0151, not modelled here):
//   work_item (workspace_id, service_id) -> service (workspace_id, id)      SVC-3
//   checklist_item (workspace_id, release_id) -> release (workspace_id, id)  REL-3
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
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  projectTable,
  serviceCalendarTable,
  teamTable,
  userTable,
  workItemTable,
  workspaceTable,
} from "./schema";

const tz = { mode: "date", withTimezone: true } as const;

/** SVC-1..SVC-4. Status is set by a person (SVC-4), never computed from open incidents. */
export const serviceTable = pgTable(
  "service",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    ownerTeamId: text("owner_team_id").references(() => teamTable.id, {
      onDelete: "set null",
    }),
    supportLevel: text("support_level").notNull().default("L1"),
    serviceCalendarId: text("service_calendar_id").references(
      () => serviceCalendarTable.id,
      { onDelete: "set null" },
    ),
    status: text("status").notNull().default("operational"),
    statusNote: text("status_note"),
    statusChangedAt: timestamp("status_changed_at", tz),
    statusChangedBy: text("status_changed_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    unique("service_workspace_id_id_unique").on(table.workspaceId, table.id),
    uniqueIndex("service_workspace_name_unique").on(
      table.workspaceId,
      sql`lower(${table.name})`,
    ),
    index("service_workspace_name_id_idx").on(
      table.workspaceId,
      table.name,
      table.id,
    ),
    check(
      "service_support_level_check",
      sql`${table.supportLevel} IN ('L1', 'L2', 'L3')`,
    ),
    check(
      "service_status_check",
      sql`${table.status} IN ('operational', 'degraded', 'outage')`,
    ),
  ],
);

/** SVC-2: documentation URL, project or knowledge base article a service links to. */
export const serviceLinkTable = pgTable(
  "service_link",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    serviceId: text("service_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label"),
    url: text("url"),
    projectId: text("project_id"),
    kbArticleId: text("kb_article_id"),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      name: "service_link_service_fk",
      columns: [table.workspaceId, table.serviceId],
      foreignColumns: [serviceTable.workspaceId, serviceTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "service_link_project_fk",
      columns: [table.workspaceId, table.projectId],
      foreignColumns: [projectTable.workspaceId, projectTable.id],
    }).onDelete("cascade"),
    index("service_link_service_idx").on(table.serviceId),
    check(
      "service_link_kind_target_check",
      sql`(${table.kind} = 'documentation' AND ${table.url} IS NOT NULL AND ${table.projectId} IS NULL AND ${table.kbArticleId} IS NULL)
        OR (${table.kind} = 'project' AND ${table.projectId} IS NOT NULL AND ${table.url} IS NULL AND ${table.kbArticleId} IS NULL)
        OR (${table.kind} = 'kb_article' AND ${table.kbArticleId} IS NOT NULL AND ${table.url} IS NULL AND ${table.projectId} IS NULL)`,
    ),
  ],
);

/** SVC-5: `service` depends on `depends_on_service`. A cycle is permitted but flagged. */
export const serviceDependencyTable = pgTable(
  "service_dependency",
  {
    workspaceId: text("workspace_id").notNull(),
    serviceId: text("service_id").notNull(),
    dependsOnServiceId: text("depends_on_service_id").notNull(),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "service_dependency_pk",
      columns: [table.serviceId, table.dependsOnServiceId],
    }),
    foreignKey({
      name: "service_dependency_service_fk",
      columns: [table.workspaceId, table.serviceId],
      foreignColumns: [serviceTable.workspaceId, serviceTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "service_dependency_depends_on_fk",
      columns: [table.workspaceId, table.dependsOnServiceId],
      foreignColumns: [serviceTable.workspaceId, serviceTable.id],
    }).onDelete("cascade"),
    index("service_dependency_depends_on_idx").on(table.dependsOnServiceId),
    check(
      "service_dependency_not_self",
      sql`${table.serviceId} <> ${table.dependsOnServiceId}`,
    ),
  ],
);

/** REL-3: the checklist a service defines; instantiated per release into `checklist_item`. */
export const serviceReleaseChecklistItemTable = pgTable(
  "service_release_checklist_item",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    serviceId: text("service_id").notNull(),
    position: integer("position").notNull(),
    text: text("text").notNull(),
  },
  (table) => [
    foreignKey({
      name: "service_release_checklist_service_fk",
      columns: [table.workspaceId, table.serviceId],
      foreignColumns: [serviceTable.workspaceId, serviceTable.id],
    }).onDelete("cascade"),
    uniqueIndex("service_release_checklist_position_unique").on(
      table.serviceId,
      table.position,
    ),
  ],
);

export const RELEASE_STATUS_VALUES = [
  "planned",
  "in_progress",
  "released",
  "cancelled",
] as const;

/** REL-1, REL-4, REL-5. */
export const releaseTable = pgTable(
  "release",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    serviceId: text("service_id").notNull(),
    plannedDate: date("planned_date", { mode: "string" }),
    status: text("status").notNull().default("planned"),
    notes: text("notes"),
    notesGeneratedAt: timestamp("notes_generated_at", tz),
    notesEditedAt: timestamp("notes_edited_at", tz),
    publishToPortal: boolean("publish_to_portal").notNull().default(false),
    publishedAt: timestamp("published_at", tz),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    unique("release_workspace_id_id_unique").on(table.workspaceId, table.id),
    foreignKey({
      name: "release_service_fk",
      columns: [table.workspaceId, table.serviceId],
      foreignColumns: [serviceTable.workspaceId, serviceTable.id],
      // CASCADE, not RESTRICT/NO ACTION: both are checked per cascaded row, so a workspace
      // delete that removes the service and its releases/changes together depends on trigger
      // order. The service delete route refuses a service that still has releases or open
      // changes before the FK is reached, so this only fires for a wholesale delete.
    }).onDelete("cascade"),
    index("release_workspace_planned_idx").on(
      table.workspaceId,
      table.plannedDate,
      table.id,
    ),
    check(
      "release_status_check",
      sql`${table.status} IN ('planned', 'in_progress', 'released', 'cancelled')`,
    ),
  ],
);

/**
 * CH-1: the satellite of a change work item. The change is still a work item; this row holds the
 * extra structure that guards and the change calendar read.
 */
export const changeDetailTable = pgTable(
  "change_detail",
  {
    workItemId: text("work_item_id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    risk: text("risk"),
    windowStart: timestamp("window_start", tz),
    windowEnd: timestamp("window_end", tz),
    rollbackPlan: text("rollback_plan"),
    releaseId: text("release_id"),
    freezeOverride: boolean("freeze_override").notNull().default(false),
    freezeOverrideReason: text("freeze_override_reason"),
    freezeOverrideBy: text("freeze_override_by").references(
      () => userTable.id,
      { onDelete: "set null" },
    ),
    freezeOverrideAt: timestamp("freeze_override_at", tz),
    // CH-4: the freezes (id + version at grant time) the standing override covers. An override is
    // freeze-scoped; any other covering freeze, or one edited since, still blocks.
    freezeOverrideFreezes: jsonb("freeze_override_freezes")
      .$type<{ id: string; version: number }[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // CH-4: set when the change passes an approving workflow edge. "Approved" is this column, not
    // the current state, so it survives moving on to In progress.
    approvedAt: timestamp("approved_at", tz),
    updatedBy: text("updated_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    unique("change_detail_workspace_work_item_unique").on(
      table.workspaceId,
      table.workItemId,
    ),
    foreignKey({
      name: "change_detail_work_item_fk",
      columns: [table.workspaceId, table.workItemId],
      foreignColumns: [workItemTable.workspaceId, workItemTable.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "change_detail_release_fk",
      columns: [table.workspaceId, table.releaseId],
      foreignColumns: [releaseTable.workspaceId, releaseTable.id],
      // SQL: `ON DELETE SET NULL (release_id)`: only the release link clears, never workspace_id.
    }).onDelete("set null"),
    index("change_detail_workspace_window_idx").on(
      table.workspaceId,
      table.windowStart,
    ),
    index("change_detail_release_idx").on(table.releaseId),
    check(
      "change_detail_risk_check",
      sql`${table.risk} IS NULL OR ${table.risk} IN ('low', 'medium', 'high')`,
    ),
    check(
      "change_detail_window_check",
      sql`(${table.windowStart} IS NULL AND ${table.windowEnd} IS NULL)
        OR (${table.windowStart} IS NOT NULL AND ${table.windowEnd} IS NOT NULL AND ${table.windowEnd} > ${table.windowStart})`,
    ),
    check(
      "change_detail_override_check",
      sql`${table.freezeOverride} = false
        OR (${table.freezeOverrideReason} IS NOT NULL AND ${table.freezeOverrideAt} IS NOT NULL)`,
    ),
  ],
);

/** CH-1 affected services. */
export const changeServiceTable = pgTable(
  "change_service",
  {
    workspaceId: text("workspace_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    serviceId: text("service_id").notNull(),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      name: "change_service_pk",
      columns: [table.workItemId, table.serviceId],
    }),
    foreignKey({
      name: "change_service_change_fk",
      columns: [table.workspaceId, table.workItemId],
      foreignColumns: [
        changeDetailTable.workspaceId,
        changeDetailTable.workItemId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "change_service_service_fk",
      columns: [table.workspaceId, table.serviceId],
      foreignColumns: [serviceTable.workspaceId, serviceTable.id],
      // CASCADE, not RESTRICT/NO ACTION: both are checked per cascaded row, so a workspace
      // delete that removes the service and its releases/changes together depends on trigger
      // order. The service delete route refuses a service that still has releases or open
      // changes before the FK is reached, so this only fires for a wholesale delete.
    }).onDelete("cascade"),
    index("change_service_service_idx").on(table.serviceId),
  ],
);

/** CH-4: a workspace-level date range during which no change may be approved. */
export const changeFreezeTable = pgTable(
  "change_freeze",
  {
    id: text("id")
      .$defaultFn(() => createId())
      .primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaceTable.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    name: text("name").notNull(),
    reason: text("reason"),
    startsAt: timestamp("starts_at", tz).notNull(),
    endsAt: timestamp("ends_at", tz).notNull(),
    cancelledAt: timestamp("cancelled_at", tz),
    cancelledBy: text("cancelled_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdBy: text("created_by").references(() => userTable.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", tz).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", tz).defaultNow().notNull(),
  },
  (table) => [
    index("change_freeze_workspace_range_idx").on(
      table.workspaceId,
      table.startsAt,
      table.endsAt,
    ),
    check(
      "change_freeze_range_check",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
  ],
);
