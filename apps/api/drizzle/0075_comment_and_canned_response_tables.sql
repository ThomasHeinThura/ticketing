CREATE TABLE "canned_response" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"body" jsonb NOT NULL,
	"visibility_default" text DEFAULT 'internal' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "canned_response_workspace_id_name_unique" UNIQUE("workspace_id","name"),
	CONSTRAINT "canned_response_visibility_default_allowed" CHECK ("canned_response"."visibility_default" in ('public', 'internal'))
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"author_id" text,
	"actor_type" text NOT NULL,
	"body" jsonb,
	"visibility" text DEFAULT 'internal' NOT NULL,
	"activity_id" text,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"deleted_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comment_visibility_allowed" CHECK ("comment"."visibility" in ('public', 'internal'))
);
--> statement-breakpoint
CREATE TABLE "comment_version" (
	"id" text PRIMARY KEY NOT NULL,
	"comment_id" text NOT NULL,
	"number" integer NOT NULL,
	"body" jsonb NOT NULL,
	"edited_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comment_version_comment_id_number_unique" UNIQUE("comment_id","number")
);
--> statement-breakpoint
ALTER TABLE "canned_response" ADD CONSTRAINT "canned_response_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_activity_id_activity_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_workspace_id_work_item_id_work_item_workspace_id_id_fk" FOREIGN KEY ("workspace_id","work_item_id") REFERENCES "public"."work_item"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_version" ADD CONSTRAINT "comment_version_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "canned_response_workspaceId_idx" ON "canned_response" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "comment_work_item_id_created_at_idx" ON "comment" USING btree ("work_item_id","created_at");--> statement-breakpoint
CREATE INDEX "comment_workspaceId_idx" ON "comment" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "comment_version_comment_id_idx" ON "comment_version" USING btree ("comment_id");