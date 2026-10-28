ALTER TABLE "label" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "service_calendar" ADD COLUMN "key" text DEFAULT 'catalogue_' || replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD COLUMN "key" text DEFAULT 'catalogue_' || replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
-- Derive legacy keys once; future edits never re-match mutable names.
CREATE FUNCTION taskdesk_catalogue_key_base(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT trim(both '-' from left(trim(both '-' from regexp_replace(
    lower(regexp_replace(normalize(trim(value), NFKD), '[̀-ͯ]', '', 'g') COLLATE "C"),
    '[^a-z0-9]+', '-', 'g')), 64));
$$;
--> statement-breakpoint
WITH bases AS (
  SELECT id, workspace_id,
    coalesce(nullif(taskdesk_catalogue_key_base(name), ''), 'legacy-' || md5(id)) AS base
  FROM "label" WHERE task_id IS NULL AND project_id IS NULL
), candidates AS (
  SELECT id, base, count(*) OVER (PARTITION BY workspace_id, base) AS matches FROM bases
)
UPDATE "label" AS target SET "key" = CASE
  WHEN candidates.matches > 1 THEN left(candidates.base, 30) || '-' || md5(candidates.id)
  ELSE candidates.base END
FROM candidates WHERE target.id = candidates.id;
--> statement-breakpoint
WITH bases AS (
  SELECT id, workspace_id,
    coalesce(nullif(taskdesk_catalogue_key_base(name), ''), 'legacy-' || md5(id)) AS base
  FROM "service_calendar" 
), candidates AS (
  SELECT id, base, count(*) OVER (PARTITION BY workspace_id, base) AS matches FROM bases
)
UPDATE "service_calendar" AS target SET "key" = CASE
  WHEN candidates.matches > 1 THEN left(candidates.base, 30) || '-' || md5(candidates.id)
  ELSE candidates.base END
FROM candidates WHERE target.id = candidates.id;
--> statement-breakpoint
WITH bases AS (
  SELECT id, workspace_id,
    coalesce(nullif(taskdesk_catalogue_key_base(name), ''), 'legacy-' || md5(id)) AS base
  FROM "sla_policy" 
), candidates AS (
  SELECT id, base, count(*) OVER (PARTITION BY workspace_id, base) AS matches FROM bases
)
UPDATE "sla_policy" AS target SET "key" = CASE
  WHEN candidates.matches > 1 THEN left(candidates.base, 30) || '-' || md5(candidates.id)
  ELSE candidates.base END
FROM candidates WHERE target.id = candidates.id;
--> statement-breakpoint
CREATE UNIQUE INDEX "label_workspace_key_unique" ON "label" USING btree ("workspace_id","key") WHERE task_id IS NULL AND project_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_calendar_workspace_key_unique" ON "service_calendar" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policy_workspace_key_unique" ON "sla_policy" USING btree ("workspace_id","key");--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_key_shape" CHECK ("label"."key" IS NULL OR "label"."key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$');--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_workspace_key_required" CHECK ("label"."task_id" IS NOT NULL OR "label"."project_id" IS NOT NULL OR "label"."key" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "service_calendar" ADD CONSTRAINT "service_calendar_key_shape" CHECK ("service_calendar"."key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$');--> statement-breakpoint
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_key_shape" CHECK ("sla_policy"."key" ~ '^[a-z0-9][a-z0-9_-]{0,63}$');
--> statement-breakpoint
-- Compatibility for existing internal insert paths; public creation captures a key explicitly.
CREATE FUNCTION taskdesk_label_catalogue_key_default() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.task_id IS NULL AND NEW.project_id IS NULL AND NEW."key" IS NULL THEN
    NEW."key" := 'catalogue_' || replace(gen_random_uuid()::text, '-', '');
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER label_catalogue_key_default BEFORE INSERT ON "label"
FOR EACH ROW EXECUTE FUNCTION taskdesk_label_catalogue_key_default();
--> statement-breakpoint
CREATE FUNCTION taskdesk_catalogue_key_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."key" IS DISTINCT FROM NEW."key" THEN
    RAISE EXCEPTION 'catalogue keys are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER label_catalogue_key_immutable BEFORE UPDATE OF "key" ON "label"
FOR EACH ROW EXECUTE FUNCTION taskdesk_catalogue_key_immutable();
--> statement-breakpoint
CREATE TRIGGER sla_policy_catalogue_key_immutable BEFORE UPDATE OF "key" ON "sla_policy"
FOR EACH ROW EXECUTE FUNCTION taskdesk_catalogue_key_immutable();
--> statement-breakpoint
CREATE TRIGGER service_calendar_catalogue_key_immutable BEFORE UPDATE OF "key" ON "service_calendar"
FOR EACH ROW EXECUTE FUNCTION taskdesk_catalogue_key_immutable();
