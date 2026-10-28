ALTER TABLE "instance_setting"
  ADD COLUMN "mcp_write_ceiling_per_minute" integer DEFAULT 30 NOT NULL;
--> statement-breakpoint
ALTER TABLE "instance_setting"
  ADD CONSTRAINT "instance_setting_mcp_write_ceiling_range"
  CHECK (mcp_write_ceiling_per_minute >= 1 AND mcp_write_ceiling_per_minute <= 100);
--> statement-breakpoint
CREATE TABLE "api_key_rate_limit_counter" (
  "api_key_id" text NOT NULL,
  "bucket" text NOT NULL,
  "window_started_at" timestamp with time zone NOT NULL,
  "request_count" integer NOT NULL,
  CONSTRAINT "api_key_rate_limit_counter_pkey" PRIMARY KEY ("api_key_id", "bucket"),
  CONSTRAINT "api_key_rate_limit_counter_api_key_id_apikey_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "apikey" ("id") ON DELETE CASCADE,
  CONSTRAINT "api_key_rate_limit_counter_bucket" CHECK (bucket IN ('total', 'mcp_write', 'mcp_bulk')),
  CONSTRAINT "api_key_rate_limit_counter_nonnegative" CHECK (request_count >= 0)
);
