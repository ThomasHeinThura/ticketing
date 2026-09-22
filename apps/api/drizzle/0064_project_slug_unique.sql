-- Issue #23's mandatory Opus security review of PR #261, finding F1 (decision log
-- 2026-09-22, "#261's mandatory Opus review F1: `project.slug` becomes globally unique").
--
-- THE DEFECT. `work_item.key` (`{project.slug}-{number}`) carries a GLOBAL unique index
-- (`work_item_key_unique`, `schema.ts`) built on the assumption that `project.slug` is
-- already unique per instance. It never was: `project.slug` had no uniqueness constraint
-- of any kind, DB- or application-level, before this migration. Two different workspaces
-- could slug a project identically and permanently collide on their first work-item key --
-- reproduced live by the review, including as a targeted attack (an attacker advances
-- their own same-slugged project's counter to deliberately burn a specific key in a
-- victim's project).
--
-- THE FIX. Make `project.slug` genuinely unique, instance-wide, matching what the schema
-- always assumed. `work_item.key`'s own uniqueness scope is UNCHANGED (Thomas's decision:
-- fix the slug side, not the key side).
--
-- EXISTING DATA. Unlike `workspace_role`'s own uniqueness retrofit (migration 0051), a
-- slug collision here carries no semantic disagreement to adjudicate -- two projects that
-- happen to share a human-chosen string are not two conflicting definitions of the same
-- thing, they are just two arbitrary strings that turn out equal. So this migration
-- REPAIRS rather than REFUSES: for every group of projects sharing a slug, the
-- earliest-created project keeps its slug unchanged, and every later-created duplicate is
-- deterministically renamed to `{slug}-2`, `{slug}-3`, … -- skipping any candidate that
-- would collide with a slug some OTHER project (real or already-renamed) already holds, so
-- the loop can never manufacture a fresh collision as it repairs an old one. This changes
-- the later duplicate's work-item key prefix going forward; it does not touch any
-- already-created `work_item` row, whose `key` was stored once at insert and never
-- regenerated (`work_item.key`'s own comment in `schema.ts`).
--
-- To find what this migration renamed, after it runs:
--   SELECT id, workspace_id, slug FROM "project" WHERE slug ~ '-[0-9]+$';
-- (a false positive is possible if a project's ORIGINAL slug happened to already end in
-- `-<digits>` -- cross-check against `workspace_id`/`name`/`created_at` if that matters.)
DO $$
DECLARE
  dup RECORD;
  candidate TEXT;
  suffix INT;
BEGIN
  FOR dup IN
    SELECT id, slug
    FROM (
      SELECT id, slug,
             row_number() OVER (
               PARTITION BY slug
               ORDER BY created_at ASC, id ASC
             ) AS rn
      FROM "project"
    ) ranked
    WHERE rn > 1
    ORDER BY slug, rn
  LOOP
    suffix := 2;
    LOOP
      candidate := dup.slug || '-' || suffix;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM "project" WHERE slug = candidate
      );
      suffix := suffix + 1;
    END LOOP;

    UPDATE "project" SET slug = candidate WHERE id = dup.id;
  END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE "project" ADD CONSTRAINT "project_slug_unique" UNIQUE("slug");
