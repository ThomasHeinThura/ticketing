/** Exact external tool names exposed by `@taskdesk/mcp`, including retained aliases. */
export const MCP_TOOL_NAMES = [
  "whoami",
  "list_projects",
  "get_project",
  "search_work_items",
  "get_work_item",
  "get_work_item_activity",
  "list_work_item_activity",
  "list_states",
  "list_time_activities",
  "list_work_item_transitions",
  "list_work_item_types",
  "list_request_types",
  "list_people",
  "get_sla_status",
  "list_approvals",
  "list_saved_views",
  "list_work_item_relations",
  "get_pending_action",
  "get_import_link",
  "create_work_item",
  "bulk_create_work_items",
  "create_import_link",
  "update_work_item",
  "set_custom_field",
  "add_label",
  "transition_work_item",
  "assign_work_item",
  "add_comment",
  "log_time",
  "create_relation",
  "delete_work_item",
  "decide_approval",
  "delete_comment",
  "delete_relation",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const MCP_TOOL_REPORT_RETENTION_DAYS = 30;
export const MCP_TOOL_REPORT_MAX_DURATION_MS = 600_000;
