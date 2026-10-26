ALTER TABLE "instance_setting" ADD COLUMN "api_key_burst_threshold" integer DEFAULT 300 NOT NULL;
--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_api_key_burst_threshold_range" CHECK (api_key_burst_threshold >= 1 AND api_key_burst_threshold <= 100000);
--> statement-breakpoint
ALTER TABLE "api_key_rate_limit_counter" DROP CONSTRAINT "api_key_rate_limit_counter_bucket";
--> statement-breakpoint
ALTER TABLE "api_key_rate_limit_counter" ADD CONSTRAINT "api_key_rate_limit_counter_bucket" CHECK (bucket IN ('total', 'mcp_write', 'mcp_bulk', 'mcp_burst'));
--> statement-breakpoint
ALTER TABLE "outbox" DROP CONSTRAINT "outbox_scope_check";
--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_scope_check" CHECK ((workspace_id IS NOT NULL) OR ((organisation_id IS NULL) AND (kind = ANY (ARRAY['pending_action.requested'::text, 'pending_action.decided'::text, 'pending_action.executed'::text, 'identity.deprovisioned'::text, 'api_key.auto_disabled'::text]))));
