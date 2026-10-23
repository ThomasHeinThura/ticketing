CREATE TABLE "work_item_sla_cache" (
  "work_item_id" text NOT NULL,
  "metric" text NOT NULL,
  "state" text NOT NULL,
  "due_at" timestamptz,
  "computed_at" timestamptz NOT NULL,
  CONSTRAINT "work_item_sla_cache_work_item_id_metric_pk" PRIMARY KEY ("work_item_id", "metric"),
  CONSTRAINT "work_item_sla_cache_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "work_item"("id") ON DELETE CASCADE,
  CONSTRAINT "work_item_sla_cache_metric_check" CHECK (metric IN ('first_response', 'resolution')),
  CONSTRAINT "work_item_sla_cache_state_check" CHECK (state IN ('none', 'ok', 'at_risk', 'breached', 'met', 'missed'))
);
--> statement-breakpoint
CREATE INDEX "work_item_sla_cache_state_due_idx" ON "work_item_sla_cache" ("state", "due_at");
