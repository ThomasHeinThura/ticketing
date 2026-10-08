ALTER TABLE "pending_action" DROP CONSTRAINT "pending_action_action_check";--> statement-breakpoint
-- Keep the retired value readable for durable rows created by 0109. Current
-- application writers and approval handlers accept only the canonical kinds;
-- legacy rows remain non-executable and are preserved for audit/history.
ALTER TABLE "pending_action" ADD CONSTRAINT "pending_action_action_check" CHECK ("pending_action"."action" in ('delete', 'bulk_delete', 'purge', 'mcp_destructive', 'user_deactivation'));
