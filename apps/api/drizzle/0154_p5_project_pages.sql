-- 0154_p5_project_pages: staff-only project pages with immutable versions (feature-contracts-p5.md,
-- "Project pages", PG-1..PG-8). Hand-written and idempotent: every statement is guarded so a re-run
-- on a populated database changes nothing and never drops or rewrites existing rows.
--
-- Both tables are new, so their foreign keys cannot scan existing rows. `project_page_parent_fk`
-- is composite on (project_id, parent_id) so a page's parent is always in the same project.
CREATE TABLE IF NOT EXISTS "project_page" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"parent_id" text,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	CONSTRAINT "project_page_project_id_id_unique" UNIQUE("project_id","id"),
	CONSTRAINT "project_page_version_positive" CHECK (version >= 1),
	CONSTRAINT "project_page_title_not_blank" CHECK (length(btrim(title)) > 0),
	CONSTRAINT "project_page_not_own_parent" CHECK (parent_id IS DISTINCT FROM id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_page_version" (
	"id" text PRIMARY KEY NOT NULL,
	"page_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'edit' NOT NULL,
	"restored_from" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_page_version_page_number_unique" UNIQUE("page_id","number"),
	CONSTRAINT "project_page_version_number_positive" CHECK (number >= 1),
	CONSTRAINT "project_page_version_kind_allowed" CHECK (kind IN ('create', 'edit', 'restore'))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_page_workspace_project_fk') THEN
    ALTER TABLE "project_page" ADD CONSTRAINT "project_page_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."project"("workspace_id","id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_page_parent_fk') THEN
    ALTER TABLE "project_page" ADD CONSTRAINT "project_page_parent_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."project_page"("project_id","id") ON DELETE no action ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_page_created_by_person_id_fk') THEN
    ALTER TABLE "project_page" ADD CONSTRAINT "project_page_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_page_updated_by_person_id_fk') THEN
    ALTER TABLE "project_page" ADD CONSTRAINT "project_page_updated_by_person_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_page_version_page_id_fk') THEN
    ALTER TABLE "project_page_version" ADD CONSTRAINT "project_page_version_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."project_page"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_page_version_created_by_person_id_fk') THEN
    ALTER TABLE "project_page_version" ADD CONSTRAINT "project_page_version_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_page_project_parent_idx" ON "project_page" USING btree ("project_id","parent_id");--> statement-breakpoint
-- PG-4: a version is an immutable snapshot. The function blocks UPDATE; versions only leave with their page.
CREATE OR REPLACE FUNCTION "project_page_version_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The one permitted change: the FK's own `ON DELETE SET NULL` on created_by when the author's
  -- person row is erased or purged. Every other column must be untouched (P5-R1-06).
  IF NEW.created_by IS NULL AND OLD.created_by IS NOT NULL
     AND (to_jsonb(NEW) - 'created_by') = (to_jsonb(OLD) - 'created_by') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'project_page_version rows are immutable' USING ERRCODE = '23000';
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "project_page_version_immutable_update" ON "project_page_version";--> statement-breakpoint
CREATE TRIGGER "project_page_version_immutable_update" BEFORE UPDATE ON "project_page_version" FOR EACH ROW EXECUTE FUNCTION "project_page_version_immutable"();--> statement-breakpoint
-- A version row may only be deleted by the FK cascade from its page (the page row is already gone when
-- that cascade runs); a direct DELETE of a version of a live page is refused (P5-R2-03).
CREATE OR REPLACE FUNCTION "project_page_version_no_direct_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project_page" WHERE "id" = OLD."page_id") THEN
    RAISE EXCEPTION 'project_page_version rows are immutable' USING ERRCODE = '23000';
  END IF;
  RETURN OLD;
END
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "project_page_version_no_direct_delete" ON "project_page_version";--> statement-breakpoint
CREATE TRIGGER "project_page_version_no_direct_delete" BEFORE DELETE ON "project_page_version" FOR EACH ROW EXECUTE FUNCTION "project_page_version_no_direct_delete"();
