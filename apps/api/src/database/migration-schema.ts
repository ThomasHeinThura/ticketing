/**
 * Drizzle declarations for tables created by frozen SQL migrations that are not
 * owned by the runtime database barrel. This file is included by drizzle.config.ts
 * so future schema generation sees the same objects as the executable SQL train.
 * Column definitions and constraints mirror the authoritative data model and the
 * creating migrations; runtime repositories continue to use their existing modules.
 */

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
  projectTable,
  workItemTable,
  workItemTypeTable,
  workspaceTable,
} from "./schema";

export const customFieldSectionTable = pgTable(
  "custom_field_section",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "custom_field_section_workspace_id_workspace_id_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaceTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    unique("custom_field_section_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    unique("custom_field_section_workspace_name_unique").on(
      table.workspaceId,
      table.name,
    ),
    check(
      "custom_field_section_position_nonnegative",
      sql.raw('"position" >= 0'),
    ),
    index("custom_field_section_workspace_position_idx").on(
      table.workspaceId,
      table.position,
      table.id,
    ),
  ],
);

export const customFieldTable = pgTable(
  "custom_field",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    sectionId: text("section_id").notNull(),
    entityType: text("entity_type").default("work_item").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    format: text("format").notNull(),
    options: jsonb("options").default(sql`'[]'::jsonb`).notNull(),
    defaultValue: jsonb("default_value"),
    helpText: text("help_text"),
    customerVisible: boolean("customer_visible").default(false).notNull(),
    visibilityCondition: jsonb("visibility_condition"),
    position: integer("position").default(0).notNull(),
    deletedAt: timestamp("deleted_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "custom_field_workspace_section_fk",
      columns: [table.workspaceId, table.sectionId],
      foreignColumns: [
        customFieldSectionTable.workspaceId,
        customFieldSectionTable.id,
      ],
    }).onDelete("restrict"),
    unique("custom_field_workspace_id_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    unique("custom_field_workspace_key_unique").on(
      table.workspaceId,
      table.key,
    ),
    check(
      "custom_field_entity_type_allowed",
      sql.raw("entity_type = 'work_item'::text"),
    ),
    check(
      "custom_field_format_allowed",
      sql.raw(
        "format = ANY (ARRAY['text'::text, 'long_text'::text, 'number'::text, 'decimal'::text, 'currency'::text, 'date'::text, 'datetime'::text, 'boolean'::text, 'select'::text, 'multi_select'::text, 'user'::text, 'multi_user'::text, 'url'::text, 'email'::text])",
      ),
    ),
    check("custom_field_key_nonempty", sql.raw("length(key) > 0")),
    check("custom_field_position_nonnegative", sql.raw('"position" >= 0')),
    index("custom_field_workspace_active_idx").on(
      table.workspaceId,
      table.deletedAt,
      table.position,
      table.id,
    ),
  ],
);

export const customFieldTypeVisibilityTable = pgTable(
  "custom_field_type_visibility",
  {
    customFieldId: text("custom_field_id").notNull(),
    workItemTypeId: text("work_item_type_id").notNull(),
    visible: boolean("visible").default(false).notNull(),
    required: boolean("required").default(false).notNull(),
  },
  (table) => [
    foreignKey({
      name: "custom_field_type_visibility_custom_field_id_custom_field_id_fk",
      columns: [table.customFieldId],
      foreignColumns: [customFieldTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "custom_field_type_visibility_work_item_type_id_work_item_type_i",
      columns: [table.workItemTypeId],
      foreignColumns: [workItemTypeTable.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    primaryKey({
      // PostgreSQL truncates the historical SQL identifier to name limit 63.
      name: "custom_field_type_visibility_custom_field_id_work_item_type_id_",
      columns: [table.customFieldId, table.workItemTypeId],
    }),
    check(
      "custom_field_type_visibility_required_visible",
      sql.raw("(NOT required) OR visible"),
    ),
    index("custom_field_type_visibility_type_idx").on(
      table.workItemTypeId,
      table.customFieldId,
    ),
  ],
);

export const customFieldValueTable = pgTable(
  "custom_field_value",
  {
    id: text("id").primaryKey(),
    customFieldId: text("custom_field_id").notNull(),
    entityType: text("entity_type").default("work_item").notNull(),
    entityId: text("entity_id").notNull(),
    value: jsonb("value").notNull(),
    projectId: text("project_id"),
    organisationId: text("organisation_id"),
    createdAt: timestamp("created_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      name: "custom_field_value_custom_field_id_custom_field_id_fk",
      columns: [table.customFieldId],
      foreignColumns: [customFieldTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "custom_field_value_project_id_project_id_fk",
      columns: [table.projectId],
      foreignColumns: [projectTable.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "custom_field_value_organisation_id_organisation_id_fk",
      columns: [table.organisationId],
      foreignColumns: [organisationTable.id],
    }).onDelete("restrict"),
    unique("custom_field_value_field_entity_unique").on(
      table.customFieldId,
      table.entityType,
      table.entityId,
    ),
    check(
      "custom_field_value_entity_type_allowed",
      sql.raw("entity_type = 'work_item'::text"),
    ),
    index("custom_field_value_project_reach_idx").on(
      table.projectId,
      table.customFieldId,
      table.entityId,
    ),
    index("custom_field_value_organisation_reach_idx").on(
      table.organisationId,
      table.customFieldId,
      table.entityId,
    ),
  ],
);

export const slaPauseTable = pgTable(
  "sla_pause",
  {
    workItemId: text("work_item_id").notNull(),
    metric: text("metric").notNull(),
    startedAt: timestamp("started_at", {
      mode: "date",
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    endedAt: timestamp("ended_at", { mode: "date", withTimezone: true }),
    reason: text("reason").notNull(),
  },
  (table) => [
    foreignKey({
      name: "sla_pause_work_item_id_work_item_id_fk",
      columns: [table.workItemId],
      foreignColumns: [workItemTable.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    primaryKey({
      name: "sla_pause_work_item_metric_started_at_pk",
      columns: [table.workItemId, table.metric, table.startedAt],
    }),
    check(
      "sla_pause_metric_allowed",
      sql.raw(
        "metric = ANY (ARRAY['first_response'::text, 'resolution'::text])",
      ),
    ),
    check(
      "sla_pause_reason_allowed",
      sql.raw(
        "reason = ANY (ARRAY['waiting_customer'::text, 'resolved'::text, 'manual'::text])",
      ),
    ),
    check(
      "sla_pause_ended_after_started",
      sql.raw("(ended_at IS NULL) OR (ended_at >= started_at)"),
    ),
    uniqueIndex("sla_pause_one_open_per_work_item_metric_unique")
      .on(table.workItemId, table.metric)
      .where(sql.raw("(ended_at IS NULL)")),
  ],
);
