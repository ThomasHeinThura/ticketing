CREATE TABLE "instance_feature_flag" (
	"feature_key" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_feature_flag_key_check" CHECK ("instance_feature_flag"."feature_key" in ('feature.cycles', 'feature.modules', 'feature.estimates', 'feature.intake', 'feature.sla', 'feature.approvals', 'feature.time_tracking', 'feature.cost_tracking', 'feature.knowledge_base', 'feature.service_catalogue', 'feature.customer_portal', 'feature.reports', 'feature.automations', 'feature.timeline', 'feature.calendar', 'feature.pages', 'feature.mcp', 'feature.scim', 'feature.import', 'feature.public_boards', 'feature.dev_links')),
	CONSTRAINT "instance_feature_flag_version_positive" CHECK ("instance_feature_flag"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "organisation_request_type" (
	"organisation_id" text NOT NULL,
	"request_type_id" text NOT NULL,
	CONSTRAINT "organisation_request_type_organisation_id_request_type_id_pk" PRIMARY KEY("organisation_id","request_type_id")
);
--> statement-breakpoint
CREATE TABLE "project_feature_flag" (
	"project_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_feature_flag_project_id_feature_key_pk" PRIMARY KEY("project_id","feature_key"),
	CONSTRAINT "project_feature_flag_key_check" CHECK ("project_feature_flag"."feature_key" in ('feature.cycles', 'feature.modules', 'feature.estimates', 'feature.intake', 'feature.sla', 'feature.approvals', 'feature.time_tracking', 'feature.cost_tracking', 'feature.knowledge_base', 'feature.service_catalogue', 'feature.customer_portal', 'feature.reports', 'feature.automations', 'feature.timeline', 'feature.calendar', 'feature.pages', 'feature.mcp', 'feature.scim', 'feature.import', 'feature.public_boards', 'feature.dev_links')),
	CONSTRAINT "project_feature_flag_version_positive" CHECK ("project_feature_flag"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "request_participant" (
	"id" text PRIMARY KEY NOT NULL,
	"work_item_id" text,
	"submission_id" text,
	"person_id" text NOT NULL,
	"added_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_participant_one_parent" CHECK (("request_participant"."work_item_id" is null) <> ("request_participant"."submission_id" is null))
);
--> statement-breakpoint
CREATE TABLE "request_type" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"group" text NOT NULL,
	"work_item_type_id" text NOT NULL,
	"form_schema" jsonb NOT NULL,
	"sla_policy_id" text,
	"default_assignee_id" text,
	"auto_accept" boolean DEFAULT false NOT NULL,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"force_private" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_type_key_unique" UNIQUE("key"),
	CONSTRAINT "request_type_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "request_type_version_positive" CHECK ("request_type"."version" > 0),
	CONSTRAINT "request_type_position_nonnegative" CHECK ("request_type"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "request_type_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"request_type_id" text NOT NULL,
	"number" integer NOT NULL,
	"form_schema" jsonb NOT NULL,
	"work_item_type_id" text NOT NULL,
	"sla_policy_id" text,
	"default_assignee_id" text,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_type_version_request_type_number_unique" UNIQUE("request_type_id","number"),
	CONSTRAINT "request_type_version_request_type_id_unique" UNIQUE("request_type_id","id")
);
--> statement-breakpoint
CREATE TABLE "submission_message" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"author_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_message_actor_type_allowed" CHECK ("submission_message"."actor_type" in ('customer', 'triager'))
);
--> statement-breakpoint
CREATE TABLE "submission" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"organisation_id" text NOT NULL,
	"requester_id" text NOT NULL,
	"request_type_id" text NOT NULL,
	"request_type_version_id" text NOT NULL,
	"form_data" jsonb NOT NULL,
	"state" text DEFAULT 'new' NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"customer_visibility" text DEFAULT 'private' NOT NULL,
	"work_item_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "submission_number_unique" UNIQUE("number"),
	CONSTRAINT "submission_number_positive" CHECK ("submission"."number" > 0),
	CONSTRAINT "submission_version_positive" CHECK ("submission"."version" > 0),
	CONSTRAINT "submission_state_allowed" CHECK ("submission"."state" in ('new', 'clarifying', 'accepted', 'declined', 'duplicate', 'withdrawn')),
	CONSTRAINT "submission_customer_visibility_allowed" CHECK ("submission"."customer_visibility" in ('private', 'organisation')),
	CONSTRAINT "submission_claim_pair" CHECK (("submission"."claimed_by" is null) = ("submission"."claimed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "workspace_feature_flag" (
	"workspace_id" text NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_feature_flag_workspace_id_feature_key_pk" PRIMARY KEY("workspace_id","feature_key"),
	CONSTRAINT "workspace_feature_flag_key_check" CHECK ("workspace_feature_flag"."feature_key" in ('feature.cycles', 'feature.modules', 'feature.estimates', 'feature.intake', 'feature.sla', 'feature.approvals', 'feature.time_tracking', 'feature.cost_tracking', 'feature.knowledge_base', 'feature.service_catalogue', 'feature.customer_portal', 'feature.reports', 'feature.automations', 'feature.timeline', 'feature.calendar', 'feature.pages', 'feature.mcp', 'feature.scim', 'feature.import', 'feature.public_boards', 'feature.dev_links')),
	CONSTRAINT "workspace_feature_flag_version_positive" CHECK ("workspace_feature_flag"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "provisioning_event" DROP CONSTRAINT "provisioning_event_kind_check";--> statement-breakpoint
ALTER TABLE "instance_feature_flag" ADD CONSTRAINT "instance_feature_flag_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "organisation_request_type" ADD CONSTRAINT "organisation_request_type_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "organisation_request_type" ADD CONSTRAINT "organisation_request_type_request_type_id_request_type_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_type"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "project_feature_flag" ADD CONSTRAINT "project_feature_flag_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_feature_flag" ADD CONSTRAINT "project_feature_flag_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_participant" ADD CONSTRAINT "request_participant_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_participant" ADD CONSTRAINT "request_participant_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_participant" ADD CONSTRAINT "request_participant_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_participant" ADD CONSTRAINT "request_participant_added_by_person_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_default_assignee_id_person_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_workspace_work_item_type_fk" FOREIGN KEY ("workspace_id","work_item_type_id") REFERENCES "public"."work_item_type"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_workspace_sla_policy_fk" FOREIGN KEY ("workspace_id","sla_policy_id") REFERENCES "public"."sla_policy"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_version" ADD CONSTRAINT "request_type_version_request_type_id_request_type_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_type"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_type_version" ADD CONSTRAINT "request_type_version_default_assignee_id_person_id_fk" FOREIGN KEY ("default_assignee_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "request_type_version" ADD CONSTRAINT "request_type_version_workspace_request_type_fk" FOREIGN KEY ("workspace_id","request_type_id") REFERENCES "public"."request_type"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_version" ADD CONSTRAINT "request_type_version_workspace_work_item_type_fk" FOREIGN KEY ("workspace_id","work_item_type_id") REFERENCES "public"."work_item_type"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_version" ADD CONSTRAINT "request_type_version_workspace_sla_policy_fk" FOREIGN KEY ("workspace_id","sla_policy_id") REFERENCES "public"."sla_policy"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_message" ADD CONSTRAINT "submission_message_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submission_message" ADD CONSTRAINT "submission_message_author_id_person_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_requester_id_person_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_claimed_by_person_id_fk" FOREIGN KEY ("claimed_by") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_work_item_id_work_item_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_item"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_request_type_version_fk" FOREIGN KEY ("request_type_id","request_type_version_id") REFERENCES "public"."request_type_version"("request_type_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_feature_flag" ADD CONSTRAINT "workspace_feature_flag_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_feature_flag" ADD CONSTRAINT "workspace_feature_flag_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "organisation_request_type_request_type_idx" ON "organisation_request_type" USING btree ("request_type_id");--> statement-breakpoint
CREATE INDEX "request_participant_person_idx" ON "request_participant" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_participant_work_item_person_unique" ON "request_participant" USING btree ("work_item_id","person_id") WHERE "request_participant"."work_item_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "request_participant_submission_person_unique" ON "request_participant" USING btree ("submission_id","person_id") WHERE "request_participant"."submission_id" is not null;--> statement-breakpoint
CREATE INDEX "request_type_workspace_position_idx" ON "request_type" USING btree ("workspace_id","position","id");--> statement-breakpoint
CREATE INDEX "request_type_version_effective_idx" ON "request_type_version" USING btree ("request_type_id","effective_from" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submission_message_thread_idx" ON "submission_message" USING btree ("submission_id","created_at","id");--> statement-breakpoint
CREATE INDEX "submission_organisation_created_idx" ON "submission" USING btree ("organisation_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submission_requester_created_idx" ON "submission" USING btree ("requester_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "submission_state_created_idx" ON "submission" USING btree ("state","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_comment_id_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comment"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_submission_id_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submission"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "provisioning_event" ADD CONSTRAINT "provisioning_event_kind_check" CHECK ("provisioning_event"."kind" in ('user.created', 'user.updated', 'user.deactivated', 'user.reactivated', 'group.directory_changed', 'group.mapping_changed', 'group.member_added', 'group.member_removed', 'request.denied', 'auth.failed', 'token.rotated', 'token.revoked', 'connection.changed', 'sync.failed'));--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "organisation_id" text;--> statement-breakpoint
ALTER TABLE "request_type" ADD COLUMN "default_project_id" text;--> statement-breakpoint
ALTER TABLE "request_type_version" ADD COLUMN "default_project_id" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type" ADD CONSTRAINT "request_type_workspace_default_project_fk" FOREIGN KEY ("workspace_id","default_project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_type_version" ADD CONSTRAINT "request_type_version_workspace_default_project_fk" FOREIGN KEY ("workspace_id","default_project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_organisation_id_idx" ON "project" USING btree ("organisation_id");--> statement-breakpoint
INSERT INTO "instance_feature_flag" ("feature_key", "enabled", "locked") VALUES
  ('feature.cycles', false, false),
  ('feature.modules', false, false),
  ('feature.estimates', false, false),
  ('feature.intake', false, false),
  ('feature.sla', false, false),
  ('feature.approvals', false, false),
  ('feature.time_tracking', false, false),
  ('feature.cost_tracking', false, false),
  ('feature.knowledge_base', false, false),
  ('feature.service_catalogue', false, false),
  ('feature.customer_portal', false, false),
  ('feature.reports', false, false),
  ('feature.automations', false, false),
  ('feature.timeline', false, false),
  ('feature.calendar', false, false),
  ('feature.pages', false, false),
  ('feature.mcp', false, false),
  ('feature.scim', true, false),
  ('feature.import', true, true),
  ('feature.public_boards', false, false),
  ('feature.dev_links', false, false);
