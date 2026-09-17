CREATE TABLE "state" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"state_template_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_template" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"group" text NOT NULL,
	"colour" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watcher" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"person_id" text NOT NULL,
	"source" text NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_key_alias" (
	"id" text PRIMARY KEY NOT NULL,
	"old_key" text NOT NULL,
	"work_item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"type_id" text NOT NULL,
	"number" integer NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"state_id" text NOT NULL,
	"priority" text,
	"assignee_id" text,
	"requester_id" text,
	"parent_id" text,
	"service_id" text,
	"start_date" timestamp,
	"due_date" timestamp,
	"position" numeric(20, 10) DEFAULT '0' NOT NULL,
	"estimate_point_id" text,
	"cycle_id" text,
	"module_id" text,
	"sla_started_at" timestamp,
	"first_response_at" timestamp,
	"resolved_at" timestamp,
	"customer_visibility" text,
	"archived_at" timestamp,
	"deleted_at" timestamp,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_item_type" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"category" text NOT NULL,
	"workflow_id" text,
	"sla_policy_id" text,
	"is_epic" boolean DEFAULT false NOT NULL,
	"is_change" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "state" ADD CONSTRAINT "state_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "state" ADD CONSTRAINT "state_state_template_id_state_template_id_fk" FOREIGN KEY ("state_template_id") REFERENCES "public"."state_template"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "state_template" ADD CONSTRAINT "state_template_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "watcher" ADD CONSTRAINT "watcher_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "watcher" ADD CONSTRAINT "watcher_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item_key_alias" ADD CONSTRAINT "work_item_key_alias_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_type_id_work_item_type_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."work_item_type"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_state_id_state_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."state"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_assignee_id_person_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_requester_id_person_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_parent_id_work_item_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."work_item"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item_type" ADD CONSTRAINT "work_item_type_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "state_projectId_idx" ON "state" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "state_stateTemplateId_idx" ON "state" USING btree ("state_template_id");--> statement-breakpoint
CREATE INDEX "state_template_workspaceId_idx" ON "state_template" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "state_template_workspace_key_unique" ON "state_template" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "watcher_workItemId_personId_unique" ON "watcher" USING btree ("work_item_id","person_id");--> statement-breakpoint
CREATE INDEX "watcher_personId_idx" ON "watcher" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_key_alias_oldKey_unique" ON "work_item_key_alias" USING btree ("old_key");--> statement-breakpoint
CREATE INDEX "work_item_key_alias_workItemId_idx" ON "work_item_key_alias" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "work_item_projectId_stateId_position_idx" ON "work_item" USING btree ("project_id","state_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_project_number_unique" ON "work_item" USING btree ("project_id","number");--> statement-breakpoint
CREATE INDEX "work_item_assigneeId_idx" ON "work_item" USING btree ("assignee_id") WHERE "work_item"."archived_at" is null and "work_item"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "work_item_dueDate_idx" ON "work_item" USING btree ("due_date") WHERE "work_item"."resolved_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_key_unique" ON "work_item" USING btree ("key");--> statement-breakpoint
CREATE INDEX "work_item_typeId_idx" ON "work_item" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "work_item_stateId_idx" ON "work_item" USING btree ("state_id");--> statement-breakpoint
CREATE INDEX "work_item_requesterId_idx" ON "work_item" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "work_item_parentId_idx" ON "work_item" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "work_item_type_workspaceId_idx" ON "work_item_type" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_type_workspace_key_unique" ON "work_item_type" USING btree ("workspace_id","key");