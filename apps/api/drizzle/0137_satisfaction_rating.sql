CREATE TABLE "satisfaction_rating" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"person_id" text NOT NULL,
	"score" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "satisfaction_rating_work_item_person_unique" UNIQUE("work_item_id","person_id"),
	CONSTRAINT "satisfaction_rating_score_range" CHECK (score >= 1 AND score <= 5),
	CONSTRAINT "satisfaction_rating_comment_length" CHECK ((comment IS NULL) OR ((char_length(comment) >= 1) AND (char_length(comment) <= 2000)))
);
--> statement-breakpoint
ALTER TABLE "satisfaction_rating" ADD CONSTRAINT "satisfaction_rating_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "satisfaction_rating" ADD CONSTRAINT "satisfaction_rating_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "satisfaction_rating_person_idx" ON "satisfaction_rating" USING btree ("person_id");