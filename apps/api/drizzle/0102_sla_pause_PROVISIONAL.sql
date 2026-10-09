CREATE TABLE "sla_pause" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"metric" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text NOT NULL,
	CONSTRAINT "sla_pause_metric_allowed" CHECK ("sla_pause"."metric" in ('first_response', 'resolution')),
	CONSTRAINT "sla_pause_interval_valid" CHECK ("sla_pause"."ended_at" is null or "sla_pause"."ended_at" >= "sla_pause"."started_at")
);
--> statement-breakpoint
ALTER TABLE "sla_pause" ADD CONSTRAINT "sla_pause_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sla_pause_one_open_per_metric_unique" ON "sla_pause" USING btree ("work_item_id","metric") WHERE "sla_pause"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "sla_pause_work_item_metric_started_idx" ON "sla_pause" USING btree ("work_item_id","metric","started_at");