ALTER TABLE "instance_setting"
  ADD COLUMN "anonymous_rate_limit_window_ms" integer NOT NULL DEFAULT 600000,
  ADD COLUMN "anonymous_rate_limit_max" integer NOT NULL DEFAULT 100;
--> statement-breakpoint
ALTER TABLE "instance_setting"
  ADD CONSTRAINT "instance_setting_anonymous_rate_limit_window_ms_range"
    CHECK ("anonymous_rate_limit_window_ms" BETWEEN 60000 AND 86400000),
  ADD CONSTRAINT "instance_setting_anonymous_rate_limit_max_range"
    CHECK ("anonymous_rate_limit_max" BETWEEN 1 AND 10000);
