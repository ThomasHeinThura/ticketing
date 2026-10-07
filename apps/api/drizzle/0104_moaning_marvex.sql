CREATE TABLE "sla_pause" (
	"work_item_id" text NOT NULL,
	"metric" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"reason" text NOT NULL,
	CONSTRAINT "sla_pause_work_item_metric_started_at_pk" PRIMARY KEY("work_item_id","metric","started_at"),
	CONSTRAINT "sla_pause_metric_allowed" CHECK ("sla_pause"."metric" in ('first_response', 'resolution')),
	CONSTRAINT "sla_pause_reason_allowed" CHECK ("sla_pause"."reason" in ('waiting_customer', 'resolved', 'manual')),
	CONSTRAINT "sla_pause_ended_after_started" CHECK ("sla_pause"."ended_at" is null or "sla_pause"."ended_at" >= "sla_pause"."started_at")
);
--> statement-breakpoint
ALTER TABLE "sla_pause" ADD CONSTRAINT "sla_pause_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "sla_pause_one_open_per_work_item_metric_unique" ON "sla_pause" USING btree ("work_item_id","metric") WHERE "sla_pause"."ended_at" is null;