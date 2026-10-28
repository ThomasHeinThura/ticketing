-- 0203_p0_review_fixes: P0 round-1 review fixes. Hand-written and idempotent.
-- P0R1-01: editing a description or comment never deletes an embedded image. The asset is
-- marked detached; `attachment-gc` removes the object and row only after the recovery window,
-- skipping assets under an open legal hold. Re-referencing the asset clears the marker.
ALTER TABLE "asset" ADD COLUMN IF NOT EXISTS "detached_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "asset_detached_at_idx" ON "asset" USING btree ("detached_at") WHERE "detached_at" IS NOT NULL;--> statement-breakpoint
-- P0R1-02 (PA-15): shared per person/session/IP step-up challenge and failed-proof budgets.
ALTER TABLE "request_rate_limit_counter" DROP CONSTRAINT IF EXISTS "request_rate_limit_counter_bucket_check";--> statement-breakpoint
ALTER TABLE "request_rate_limit_counter" ADD CONSTRAINT "request_rate_limit_counter_bucket_check" CHECK ("request_rate_limit_counter"."bucket" IN ('anonymous_scim_failure', 'scim_connection', 'anonymous_invitation', 'anonymous_csp_report', 'step_up_challenge', 'step_up_proof_failure'));
