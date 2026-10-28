import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { apikeyTable } from "./schema";

/** Low-trust client diagnostics, never business authority or execution evidence. */
export const mcpToolInvocationTable = pgTable(
  "mcp_tool_invocation",
  {
    apiKeyId: text("api_key_id")
      .notNull()
      .references(() => apikeyTable.id, { onDelete: "cascade" }),
    invocationId: uuid("invocation_id").notNull(),
    toolName: text("tool_name").notNull(),
    durationMs: integer("duration_ms").notNull(),
    outcome: text("outcome").notNull(),
    recordedAt: timestamp("recorded_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.apiKeyId, table.invocationId] }),
    check(
      "mcp_tool_invocation_tool_allowed",
      sql`${table.toolName} IN ('whoami', 'list_projects', 'get_project', 'search_work_items', 'get_work_item', 'get_work_item_activity', 'list_work_item_activity', 'list_states', 'list_time_activities', 'list_work_item_transitions', 'list_work_item_types', 'list_request_types', 'list_people', 'get_sla_status', 'list_approvals', 'list_saved_views', 'list_work_item_relations', 'get_pending_action', 'create_work_item', 'update_work_item', 'set_custom_field', 'add_label', 'transition_work_item', 'assign_work_item', 'add_comment', 'log_time', 'create_relation', 'delete_work_item', 'decide_approval', 'delete_comment', 'delete_relation')`,
    ),
    check(
      "mcp_tool_invocation_duration_bounded",
      sql`${table.durationMs} BETWEEN 0 AND 600000`,
    ),
    check(
      "mcp_tool_invocation_outcome_allowed",
      sql`${table.outcome} IN ('success', 'error')`,
    ),
    index("mcp_tool_invocation_key_recorded_idx").on(
      table.apiKeyId,
      table.recordedAt,
    ),
    index("mcp_tool_invocation_retention_idx").on(table.recordedAt),
  ],
);
