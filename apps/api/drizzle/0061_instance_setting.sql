CREATE TABLE "instance_setting" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"setup_completed_at" timestamp,
	"setup_token_hash" text,
	"setup_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "instance_setting_id_singleton" CHECK ("instance_setting"."id" = 'singleton')
);
--> statement-breakpoint
-- #18 security review (F2): back-fill, not just create. Without this, every
-- instance that already has at least one user row (i.e. already existed before
-- this migration -- including the live UAT stack) would have no
-- instance_setting row at all. isSetupCompleted() would read that as "never
-- set up," so ensureSetupToken() would print a full setup-token banner on
-- EVERY boot forever (log noise, and a live secret in logs that may be read
-- more widely than the database) -- and worse, the "wiping every admin cannot
-- re-open the bootstrap window" guarantee this whole PR exists to add would
-- not actually cover that instance, because existingUserCount would still be
-- able to fall back to zero with setup_completed_at never having been set.
-- A fresh instance (no user rows yet) is untouched by this statement and goes
-- through the real first-run flow exactly as designed.
INSERT INTO "instance_setting" ("id", "setup_completed_at")
SELECT 'singleton', now()
WHERE EXISTS (SELECT 1 FROM "user")
ON CONFLICT ("id") DO NOTHING;
