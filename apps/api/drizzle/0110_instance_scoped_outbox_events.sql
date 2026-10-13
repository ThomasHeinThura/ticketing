ALTER TABLE "outbox" ALTER COLUMN "workspace_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_scope_check" CHECK ("workspace_id" is not null or "kind" in ('pending_action.requested', 'pending_action.decided', 'pending_action.executed', 'identity.deprovisioned'));
