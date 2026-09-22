-- Issue #23's mandatory Opus security review of PR #261, F1's delta-confirmation pass (D1,
-- 2026-09-22, "F1 itself is not closed: the slug namespace is transient, the key-claim
-- namespace is permanent").
--
-- THE GAP MIGRATION 0064 LEFT. `project_slug_unique` (0064) only constrains the set of
-- slugs held by rows CURRENTLY in `project`. `work_item.key` (`{project.slug}-{number}`)
-- is generated from `project.slug` but claimed PERMANENTLY in `work_item_key_claim`,
-- which never releases a claim even after the work item or its project is gone. A slug
-- that is merely unique among LIVE rows can still be freed -- by renaming the project that
-- holds it (`PUT /api/project/{id}`), or by hard-deleting its workspace (`DELETE
-- /api/workspace/{id}`, which cascades the project away with no FK stopping it) -- and
-- handed to an unrelated later tenant, who then collides on a key range the first
-- slug-holder already burned. Reproduced live, twice, by the delta-confirmation review.
--
-- THE FIX. `project_slug_claim` mirrors `work_item_key_claim`'s own lifetime semantics
-- exactly: once a slug is claimed here, by any project, it is claimed forever. See
-- `apps/api/src/database/schema.ts`'s comment on `projectSlugClaimTable` for the full
-- design (in particular why `project_id` carries no foreign key). Application code
-- (`create-project.ts`, `update-project.ts`) checks this table before accepting a slug and
-- writes to it in the same transaction as the project insert/update; this table's own
-- PRIMARY KEY is the backstop for the race between that check and the write, same idiom as
-- `project_slug_unique` itself.
CREATE TABLE "project_slug_claim" (
	"slug" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

-- BACKFILL, AND ITS HONEST LIMITATION. This can only claim the slugs migration 0064 could
-- already see: every project LIVE on `main` right now (0064's own repair loop already
-- resolved any duplicates among them before `project_slug_unique` was added, so this is a
-- straight one-row-per-slug copy, no ranking needed). It has NO visibility into a slug that
-- was already freed -- by a rename or a workspace hard-delete -- at any point BEFORE this
-- migration ran. Any such already-freed, already-poisoned slug remains reusable and
-- remains a live F1/D1 collision risk; this migration protects only slugs that are live
-- today, going forward, from the two release paths D1 identified. Closing the pre-existing
-- gap would require reconstructing history this schema was never designed to retain.
INSERT INTO "project_slug_claim" ("slug", "project_id", "created_at")
SELECT "slug", "id", "created_at" FROM "project"
ON CONFLICT ("slug") DO NOTHING;
