CREATE TABLE "membership" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"role_id" text NOT NULL,
	"sees_all" boolean DEFAULT false NOT NULL,
	"inherited_from" text,
	"derived_from" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organisation_quota" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"max_projects" integer DEFAULT 200 NOT NULL,
	"max_work_items" integer DEFAULT 500000 NOT NULL,
	"max_storage_bytes" bigint DEFAULT 21474836480 NOT NULL,
	"max_portal_users" integer DEFAULT 500 NOT NULL,
	"max_api_requests_per_minute" integer DEFAULT 600 NOT NULL,
	"max_webhooks" integer DEFAULT 10 NOT NULL,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_quota_organisation_id_unique" UNIQUE("organisation_id")
);
--> statement-breakpoint
CREATE TABLE "organisation" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"domain" text[],
	"active" boolean DEFAULT true NOT NULL,
	"portal_access" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"purge_after" timestamp,
	"default_customer_visibility" text DEFAULT 'organisation' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"organisation_id" text NOT NULL,
	"side" text NOT NULL,
	"job_title" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"locale" text,
	"quiet_hours_start" text,
	"quiet_hours_end" text,
	"quiet_hours_timezone" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"workspace_id" text,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"rank" integer NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_editable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "organisation_quota" ADD CONSTRAINT "organisation_quota_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "organisation_quota" ADD CONSTRAINT "organisation_quota_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "membership_personId_idx" ON "membership" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "membership_roleId_idx" ON "membership" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "membership_scope_scopeId_idx" ON "membership" USING btree ("scope","scope_id");--> statement-breakpoint
CREATE INDEX "organisation_quota_organisationId_idx" ON "organisation_quota" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisation_is_internal_unique" ON "organisation" USING btree ("is_internal") WHERE "organisation"."is_internal" = true;--> statement-breakpoint
CREATE INDEX "person_userId_idx" ON "person" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "person_organisationId_idx" ON "person" USING btree ("organisation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "person_organisation_user_unique" ON "person" USING btree ("organisation_id","user_id") WHERE "person"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "role_workspaceId_idx" ON "role" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_scope_workspace_key_unique" ON "role" USING btree ("scope",coalesce("workspace_id", ''),"key");