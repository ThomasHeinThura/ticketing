-- First-user setup now completes only after the first administrator verifies TOTP, and a
-- signed-in user on a database with no setup marker is treated as that pending administrator
-- (agent API requests answer 403 mfa_enrollment_required). Before this version any user row
-- closed the first-run flow, so a database that already has users has been claimed and must be
-- marked complete here, or the upgrade locks everyone out: with more than one user no setup
-- token is issued and the verified-TOTP finalisation, which needs a sole user, cannot run.
-- This is the same rule migration 0061 applied. One-shot and forward-only: it never reaches an
-- instance created by this version, whose first-run state is written after migrations have run,
-- and an empty database is untouched so it goes through the verified first-run flow. A marker
-- that is already set is never overwritten.
INSERT INTO "instance_setting" ("id", "setup_completed_at")
SELECT 'singleton', now()
WHERE EXISTS (SELECT 1 FROM "user")
ON CONFLICT ("id") DO UPDATE SET
	"setup_completed_at" = now(),
	"setup_token_hash" = NULL,
	"setup_token_expires_at" = NULL,
	"updated_at" = now()
WHERE "instance_setting"."setup_completed_at" IS NULL;
