CREATE TABLE "mcp_tool_invocation" (
	"api_key_id" text NOT NULL,
	"invocation_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"outcome" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_tool_invocation_api_key_id_invocation_id_pk" PRIMARY KEY("api_key_id","invocation_id"),
	CONSTRAINT "mcp_tool_invocation_tool_allowed" CHECK ("mcp_tool_invocation"."tool_name" IN ('whoami', 'list_projects', 'get_project', 'search_work_items', 'get_work_item', 'get_work_item_activity', 'list_work_item_activity', 'list_states', 'list_time_activities', 'list_work_item_transitions', 'list_work_item_types', 'list_request_types', 'list_people', 'get_sla_status', 'list_approvals', 'list_saved_views', 'list_work_item_relations', 'get_pending_action', 'create_work_item', 'update_work_item', 'set_custom_field', 'add_label', 'transition_work_item', 'assign_work_item', 'add_comment', 'log_time', 'create_relation', 'delete_work_item', 'decide_approval', 'delete_comment', 'delete_relation')),
	CONSTRAINT "mcp_tool_invocation_duration_bounded" CHECK ("mcp_tool_invocation"."duration_ms" BETWEEN 0 AND 600000),
	CONSTRAINT "mcp_tool_invocation_outcome_allowed" CHECK ("mcp_tool_invocation"."outcome" IN ('success', 'error'))
);
--> statement-breakpoint
ALTER TABLE "mcp_tool_invocation" ADD CONSTRAINT "mcp_tool_invocation_api_key_id_apikey_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_tool_invocation_key_recorded_idx" ON "mcp_tool_invocation" USING btree ("api_key_id","recorded_at");--> statement-breakpoint
CREATE INDEX "mcp_tool_invocation_retention_idx" ON "mcp_tool_invocation" USING btree ("recorded_at");