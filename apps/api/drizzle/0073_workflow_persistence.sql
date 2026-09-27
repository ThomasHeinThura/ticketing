CREATE TABLE "scheduled_transition" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"transition_id" text NOT NULL,
	"from_state_id" text NOT NULL,
	"to_state_id" text NOT NULL,
	"due_at" timestamp NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_transition_state_allowed" CHECK ("scheduled_transition"."state" in ('pending', 'fired', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"active_version_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_transition" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"from_state_template_id" text,
	"to_state_template_id" text NOT NULL,
	"role_id" text,
	"note_policy" text DEFAULT 'none' NOT NULL,
	"note_visibility" text DEFAULT 'internal' NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"approval_policy" text,
	"requires_cab" boolean DEFAULT false NOT NULL,
	"is_reopen" boolean DEFAULT false NOT NULL,
	"guards" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"effects" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_transition_note_policy_allowed" CHECK ("workflow_transition"."note_policy" in ('none', 'optional', 'required')),
	CONSTRAINT "workflow_transition_note_visibility_allowed" CHECK ("workflow_transition"."note_visibility" in ('public', 'internal')),
	CONSTRAINT "workflow_transition_approval_policy_allowed" CHECK ("workflow_transition"."approval_policy" is null or "workflow_transition"."approval_policy" in ('any', 'all'))
);
--> statement-breakpoint
CREATE TABLE "workflow_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_id" text NOT NULL,
	"number" integer NOT NULL,
	"published_at" timestamp,
	"published_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scheduled_transition" ADD CONSTRAINT "scheduled_transition_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scheduled_transition" ADD CONSTRAINT "scheduled_transition_transition_id_workflow_transition_id_fk" FOREIGN KEY ("transition_id") REFERENCES "public"."workflow_transition"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "scheduled_transition" ADD CONSTRAINT "scheduled_transition_project_id_from_state_id_state_project_id_id_fk" FOREIGN KEY ("project_id","from_state_id") REFERENCES "public"."state"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_transition" ADD CONSTRAINT "scheduled_transition_project_id_to_state_id_state_project_id_id_fk" FOREIGN KEY ("project_id","to_state_id") REFERENCES "public"."state"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_transition" ADD CONSTRAINT "scheduled_transition_project_id_work_item_id_work_item_project_id_id_fk" FOREIGN KEY ("project_id","work_item_id") REFERENCES "public"."work_item"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_active_version_id_workflow_version_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."workflow_version"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_version_id_workflow_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."workflow_version"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_from_state_template_id_state_template_id_fk" FOREIGN KEY ("from_state_template_id") REFERENCES "public"."state_template"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_to_state_template_id_state_template_id_fk" FOREIGN KEY ("to_state_template_id") REFERENCES "public"."state_template"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow_transition" ADD CONSTRAINT "workflow_transition_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_published_by_person_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "scheduled_transition_dueAt_pending_idx" ON "scheduled_transition" USING btree ("due_at") WHERE "scheduled_transition"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "scheduled_transition_workItemId_idx" ON "scheduled_transition" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "workflow_workspaceId_idx" ON "workflow" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_workspace_key_unique" ON "workflow" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "workflow_transition_versionId_idx" ON "workflow_transition" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "workflow_transition_fromStateTemplateId_idx" ON "workflow_transition" USING btree ("from_state_template_id");--> statement-breakpoint
CREATE INDEX "workflow_transition_toStateTemplateId_idx" ON "workflow_transition" USING btree ("to_state_template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_transition_version_reopen_unique" ON "workflow_transition" USING btree ("version_id") WHERE "workflow_transition"."is_reopen";--> statement-breakpoint
CREATE INDEX "workflow_version_workflowId_idx" ON "workflow_version" USING btree ("workflow_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_version_workflow_number_unique" ON "workflow_version" USING btree ("workflow_id","number");--> statement-breakpoint
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_workflow_id_workflow_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflow"("id") ON DELETE restrict ON UPDATE cascade;