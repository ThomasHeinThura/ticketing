CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"shared_with_team_id" text,
	"query" jsonb NOT NULL,
	"layout" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_view_scope_allowed" CHECK ("saved_view"."scope" in ('workspace', 'project')),
	CONSTRAINT "saved_view_visibility_allowed" CHECK ("saved_view"."visibility" in ('private', 'team', 'workspace')),
	CONSTRAINT "saved_view_layout_allowed" CHECK ("saved_view"."layout" in ('board', 'list', 'table', 'calendar', 'timeline', 'chart')),
	CONSTRAINT "saved_view_team_visibility_consistency" CHECK (("saved_view"."visibility" = 'team') = ("saved_view"."shared_with_team_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "user_preference" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_preference_scope_allowed" CHECK ("user_preference"."scope" in ('global', 'workspace', 'project'))
);
--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_shared_with_team_id_team_id_fk" FOREIGN KEY ("shared_with_team_id") REFERENCES "public"."team"("id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "saved_view_workspace_id_idx" ON "saved_view" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "saved_view_created_by_idx" ON "saved_view" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "saved_view_shared_with_team_id_idx" ON "saved_view" USING btree ("shared_with_team_id");--> statement-breakpoint
CREATE INDEX "user_preference_person_id_idx" ON "user_preference" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_preference_global_key_unique" ON "user_preference" USING btree ("person_id","scope","key") WHERE "user_preference"."scope_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_preference_scoped_key_unique" ON "user_preference" USING btree ("person_id","scope","scope_id","key") WHERE "user_preference"."scope_id" is not null;
