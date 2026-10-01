CREATE TABLE "pending_action" (
  "id" text PRIMARY KEY NOT NULL,
  "requested_by_person_id" text NOT NULL,
  "credential_type" text NOT NULL,
  "credential_id" text,
  "origin" text NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_ids" text[] NOT NULL,
  "target_versions" jsonb,
  "payload" jsonb NOT NULL,
  "route_key" text NOT NULL,
  "payload_hash" text NOT NULL,
  "payload_summary" jsonb NOT NULL,
  "workspace_id" text,
  "project_id" text,
  "organisation_id" text,
  "confirmation_required" text NOT NULL,
  "confirmation_supplied" jsonb,
  "state" text DEFAULT 'pending' NOT NULL,
  "invalidation_reason" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "decided_by_person_id" text,
  "decision_session_id" text,
  "decided_at" timestamptz,
  "step_up_token_id" text,
  "executed_at" timestamptz,
  "error" text,
  "trace_id" text NOT NULL,
  CONSTRAINT "pending_action_credential_type_check" CHECK ("credential_type" IN ('session', 'api_key')),
  CONSTRAINT "pending_action_origin_check" CHECK ("origin" IN ('web', 'api', 'mcp')),
  CONSTRAINT "pending_action_action_check" CHECK ("action" IN ('delete', 'bulk_delete', 'purge', 'mcp_destructive')),
  CONSTRAINT "pending_action_confirmation_check" CHECK ("confirmation_required" IN ('click', 'typed_name', 'typed_count', 'typed_count_step_up', 'typed_name_step_up')),
  CONSTRAINT "pending_action_state_check" CHECK ("state" IN ('pending', 'approved', 'denied', 'cancelled', 'expired', 'invalidated', 'executed', 'failed')),
  CONSTRAINT "pending_action_invalidation_reason_check" CHECK ("invalidation_reason" IS NULL OR "invalidation_reason" IN ('credential_revoked', 'requester_deactivated', 'reach_lost', 'capability_removed', 'version_changed', 'scope_changed')),
  CONSTRAINT "pending_action_payload_hash_check" CHECK ("payload_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "pending_action_targets_nonempty" CHECK (cardinality("target_ids") > 0)
);

CREATE INDEX "pending_action_requester_state_expires_idx"
  ON "pending_action" ("requested_by_person_id", "state", "expires_at");
CREATE INDEX "pending_action_workspace_created_idx"
  ON "pending_action" ("workspace_id", "created_at" DESC);
CREATE UNIQUE INDEX "pending_action_one_pending_target_unique"
  ON "pending_action" ("requested_by_person_id", "action", "target_ids", "state")
  WHERE "state" = 'pending';
