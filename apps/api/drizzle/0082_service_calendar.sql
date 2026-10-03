CREATE TABLE "service_calendar" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"windows" jsonb NOT NULL,
	"holidays" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_calendar" ADD CONSTRAINT "service_calendar_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "service_calendar_workspace_name_id_idx" ON "service_calendar" USING btree ("workspace_id", "name", "id");
