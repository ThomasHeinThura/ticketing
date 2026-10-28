-- P4 NO-17 / NO-5: `instance_setting.notification_retention_days` (read-notification
-- retention, default 90) and `instance_setting.timezone` (digest-window zone fallback).
-- Additive on the singleton row; every existing instance takes the defaults.
ALTER TABLE "instance_setting" ADD COLUMN "notification_retention_days" integer DEFAULT 90 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD CONSTRAINT "instance_setting_notification_retention_days_positive" CHECK (notification_retention_days >= 1);--> statement-breakpoint
-- Mark-read used to set only `is_read`; NO-17 retention keys on `read_at`, so backfill the
-- read time of already-read rows from their last update (a UTC wall clock, like every
-- `timestamp without time zone` column here).
UPDATE "notification" SET "read_at" = ("updated_at" AT TIME ZONE 'UTC') WHERE "is_read" = true AND "read_at" IS NULL;
