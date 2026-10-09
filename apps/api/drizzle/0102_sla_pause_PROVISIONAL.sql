-- PROVISIONAL semantic migration unit for the existing SLA pause contract.
-- The integrating session owns final migration allocation/journal updates.
CREATE TABLE "sla_pause" (
  "id" text PRIMARY KEY NOT NULL,
  "work_item_id" text NOT NULL REFERENCES "work_item"("id") ON DELETE CASCADE,
  "metric" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "reason" text NOT NULL,
  CONSTRAINT "sla_pause_metric_allowed" CHECK ("metric" IN ('first_response', 'resolution')),
  CONSTRAINT "sla_pause_interval_valid" CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sla_pause_one_open_per_metric_unique"
  ON "sla_pause" ("work_item_id", "metric") WHERE "ended_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "sla_pause_work_item_metric_started_idx"
  ON "sla_pause" ("work_item_id", "metric", "started_at");
