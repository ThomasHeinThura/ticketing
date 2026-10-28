-- P5 KB-1..KB-17: knowledge base articles, categories, immutable versions, feedback and deflection events.
-- Additive. A project-scoped article goes with its project when that project is purged (the workspace delete
-- removes projects before the workspace row, so a restricting key would break it). The review-step switch is a workspace column (data-model.md `workspace.kb_review_step_enabled`).
ALTER TABLE "workspace" ADD COLUMN IF NOT EXISTS "kb_review_step_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_category" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"parent_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_category_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "kb_category_name_length" CHECK ((char_length(name) >= 1) AND (char_length(name) <= 120)),
	CONSTRAINT "kb_category_not_own_parent" CHECK (parent_id IS NULL OR parent_id <> id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_article" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text,
	"category_id" text,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"author_id" text,
	"owner_id" text,
	"review_due_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"published_version" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_article_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "kb_article_title_length" CHECK ((char_length(title) >= 1) AND (char_length(title) <= 200)),
	CONSTRAINT "kb_article_state_allowed" CHECK (state = ANY (ARRAY['draft'::text, 'in_review'::text, 'published'::text, 'archived'::text])),
	CONSTRAINT "kb_article_published_has_version" CHECK ((state = 'published') = (published_version IS NOT NULL)),
	CONSTRAINT "kb_article_version_positive" CHECK (version >= 1),
	CONSTRAINT "kb_article_view_count_nonnegative" CHECK (view_count >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_article_version" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_article_version_article_number_unique" UNIQUE("article_id","number"),
	CONSTRAINT "kb_article_version_number_positive" CHECK (number >= 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kb_article_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"person_id" text NOT NULL,
	"helpful" boolean NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_article_feedback_person_unique" UNIQUE("article_id","person_id"),
	CONSTRAINT "kb_article_feedback_comment_length" CHECK (comment IS NULL OR char_length(comment) <= 2000)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "deflection_event" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"person_id" text NOT NULL,
	"request_type_id" text,
	"kb_article_id" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"abandoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deflection_event_query_length" CHECK (char_length(query) <= 500)
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_category_workspace_id_workspace_id_fk') THEN
    ALTER TABLE "kb_category" ADD CONSTRAINT "kb_category_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_category_parent_fk') THEN
    ALTER TABLE "kb_category" ADD CONSTRAINT "kb_category_parent_fk" FOREIGN KEY ("workspace_id","parent_id") REFERENCES "public"."kb_category"("workspace_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_workspace_id_workspace_id_fk') THEN
    ALTER TABLE "kb_article" ADD CONSTRAINT "kb_article_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_project_fk') THEN
    ALTER TABLE "kb_article" ADD CONSTRAINT "kb_article_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_category_fk') THEN
    ALTER TABLE "kb_article" ADD CONSTRAINT "kb_article_category_fk" FOREIGN KEY ("workspace_id","category_id") REFERENCES "public"."kb_category"("workspace_id","id") ON DELETE no action ON UPDATE no action NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_author_id_person_id_fk') THEN
    ALTER TABLE "kb_article" ADD CONSTRAINT "kb_article_author_id_person_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_owner_id_person_id_fk') THEN
    ALTER TABLE "kb_article" ADD CONSTRAINT "kb_article_owner_id_person_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_version_article_id_fk') THEN
    ALTER TABLE "kb_article_version" ADD CONSTRAINT "kb_article_version_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_article"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_version_created_by_person_id_fk') THEN
    ALTER TABLE "kb_article_version" ADD CONSTRAINT "kb_article_version_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_feedback_article_id_fk') THEN
    ALTER TABLE "kb_article_feedback" ADD CONSTRAINT "kb_article_feedback_article_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."kb_article"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kb_article_feedback_person_id_person_id_fk') THEN
    ALTER TABLE "kb_article_feedback" ADD CONSTRAINT "kb_article_feedback_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deflection_event_workspace_id_workspace_id_fk') THEN
    ALTER TABLE "deflection_event" ADD CONSTRAINT "deflection_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deflection_event_person_id_person_id_fk') THEN
    ALTER TABLE "deflection_event" ADD CONSTRAINT "deflection_event_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deflection_event_request_type_id_request_type_id_fk') THEN
    ALTER TABLE "deflection_event" ADD CONSTRAINT "deflection_event_request_type_id_request_type_id_fk" FOREIGN KEY ("request_type_id") REFERENCES "public"."request_type"("id") ON DELETE set null ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deflection_event_kb_article_id_fk') THEN
    ALTER TABLE "deflection_event" ADD CONSTRAINT "deflection_event_kb_article_id_fk" FOREIGN KEY ("kb_article_id") REFERENCES "public"."kb_article"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_category_workspace_idx" ON "kb_category" USING btree ("workspace_id","parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_article_workspace_state_idx" ON "kb_article" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_article_category_idx" ON "kb_article" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_article_project_idx" ON "kb_article" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_article_review_due_idx" ON "kb_article" USING btree ("workspace_id","review_due_at") WHERE (review_due_at IS NOT NULL);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_article_feedback_person_idx" ON "kb_article_feedback" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deflection_event_workspace_created_idx" ON "deflection_event" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deflection_event_article_idx" ON "deflection_event" USING btree ("kb_article_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deflection_event_person_idx" ON "deflection_event" USING btree ("person_id");--> statement-breakpoint
-- KB-3: a version is an immutable snapshot. The function blocks UPDATE; versions only leave with their article.
CREATE OR REPLACE FUNCTION "kb_article_version_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The one permitted change: the FK's own `ON DELETE SET NULL` on created_by when the author's
  -- person row is erased or purged. Every other column must be untouched (P5-R1-06).
  IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
     AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'kb_article_version rows are immutable' USING ERRCODE = '23000';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "kb_article_version_immutable_update" ON "kb_article_version";--> statement-breakpoint
CREATE TRIGGER "kb_article_version_immutable_update" BEFORE UPDATE ON "kb_article_version" FOR EACH ROW EXECUTE FUNCTION "kb_article_version_immutable"();--> statement-breakpoint
-- A version row may only be deleted by the FK cascade from its article (the article row is already gone
-- when that cascade runs); a direct DELETE of a version of a live article is refused (P5-R2-03).
CREATE OR REPLACE FUNCTION "kb_article_version_no_direct_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "kb_article" WHERE "id" = OLD."article_id") THEN
    RAISE EXCEPTION 'kb_article_version rows are immutable' USING ERRCODE = '23000';
  END IF;
  RETURN OLD;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "kb_article_version_no_direct_delete" ON "kb_article_version";--> statement-breakpoint
CREATE TRIGGER "kb_article_version_no_direct_delete" BEFORE DELETE ON "kb_article_version" FOR EACH ROW EXECUTE FUNCTION "kb_article_version_no_direct_delete"();

