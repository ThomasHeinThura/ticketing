CREATE TABLE "work_item_label" (
	"work_item_id" text NOT NULL,
	"label_id" text NOT NULL,
	CONSTRAINT "work_item_label_work_item_id_label_id_pk" PRIMARY KEY("work_item_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_label" ADD CONSTRAINT "work_item_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_item_label_label_id_idx" ON "work_item_label" USING btree ("label_id");