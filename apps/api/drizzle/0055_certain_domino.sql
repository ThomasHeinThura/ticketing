CREATE TABLE "work_item_key_claim" (
	"key" text PRIMARY KEY NOT NULL,
	"work_item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_key_claim_key_work_item_id_unique" UNIQUE("key","work_item_id")
);
--> statement-breakpoint
ALTER TABLE "work_item" DROP CONSTRAINT "work_item_state_id_state_id_fk";
--> statement-breakpoint
ALTER TABLE "work_item" DROP CONSTRAINT "work_item_parent_id_work_item_id_fk";
--> statement-breakpoint
ALTER TABLE "work_item" ALTER COLUMN "customer_visibility" SET DEFAULT 'private';--> statement-breakpoint
ALTER TABLE "work_item" ALTER COLUMN "customer_visibility" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "work_item_key_claim_workItemId_idx" ON "work_item_key_claim" USING btree ("work_item_id");--> statement-breakpoint
-- #191 (drizzle-kit ordering gap, same class as #186's judgment call #2): drizzle-kit's
-- own generated statement order placed the two new composite FKs below BEFORE the
-- UNIQUE constraints they target (`state_project_id_id_unique`,
-- `work_item_project_id_id_unique`), which fails identically to #186's original ordering
-- bug ("there is no unique constraint matching given keys for referenced table"). Hand-
-- reordered: the two UNIQUE constraints are moved here, ahead of every FK that targets
-- them; no statement's own content was changed, only its position. Verified this
-- actually matters by reproducing the failure with drizzle-kit's own original order
-- before reordering, the same way #186 did.
ALTER TABLE "state" ADD CONSTRAINT "state_project_id_id_unique" UNIQUE("project_id","id");--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_id_id_unique" UNIQUE("project_id","id");--> statement-breakpoint
ALTER TABLE "work_item_key_alias" ADD CONSTRAINT "work_item_key_alias_old_key_work_item_id_work_item_key_claim_key_work_item_id_fk" FOREIGN KEY ("old_key","work_item_id") REFERENCES "public"."work_item_key_claim"("key","work_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_id_state_id_state_project_id_id_fk" FOREIGN KEY ("project_id","state_id") REFERENCES "public"."state"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_id_parent_id_work_item_project_id_id_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."work_item"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_key_id_work_item_key_claim_key_work_item_id_fk" FOREIGN KEY ("key","id") REFERENCES "public"."work_item_key_claim"("key","work_item_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- #191 O2/O3 -- replaces #186 S5's `work_item_key_alias_reject_live_collision` TRIGGER
-- (a check-then-act EXISTS check with an unlocked TOCTOU race, proven live under plain
-- READ COMMITTED and confirmed NOT fixed by SERIALIZABLE isolation) with the
-- `work_item_key_claim` registry table above -- a real PRIMARY KEY/UNIQUE index closes
-- the race by construction. `work_item_key_alias.old_key` (composite FK above) never
-- needs a trigger of its own: it only ever references a claim that must already exist.
-- `work_item.key` DOES need one, because populating the claim table on every insert/
-- rekey is the one piece a plain FK cannot express ("also insert into this other
-- table") -- so this trigger performs the claiming INSERT directly, with NO preceding
-- SELECT/EXISTS check of its own, so the claim table's real PRIMARY KEY (not this
-- function's logic) is what actually rejects a collision, atomically, under any
-- concurrent interleaving. See `work_item_key_claim`'s own comment in schema.ts for the
-- full design and `docs/04-engineering/migrations.md`'s "The `work_item.key`
-- assignment" section, which documents Postgres's BEFORE-trigger firing order, for how
-- the future rekey/assignment trigger must sequence against this one.
--
-- The fully-qualified `public.work_item_key_claim` reference below is the actual defense
-- against a session-local `CREATE TEMP TABLE work_item_key_claim (...)` shadow (#191 O3,
-- found on #186 S5's original trigger and fixed here from the start rather than
-- repeated): an explicitly schema-qualified name is resolved directly, never through
-- `search_path`, so it can never be shadowed by a same-named relation in `pg_temp`. Do
-- NOT remove this qualification as apparently-redundant cleanup.
--
-- `SET search_path = pg_catalog, public` below is NOT what closes that bypass (#191 N3 --
-- this comment previously said it was, which is wrong, verified live against Postgres):
-- the temporary schema is searched FIRST, ahead of every schema `search_path` names,
-- unless `pg_temp` is listed explicitly in it -- which this pin does not do. An
-- unqualified reference here would still resolve to a session's own temp table ahead of
-- the real one even with this exact pin in place. The pin is kept anyway as
-- defense-in-depth against any OTHER unqualified identifier a future edit to this
-- function might add, but the qualification above, not this pin, is why the bypass is
-- closed today. (`SECURITY INVOKER`, the default here, is correct either way -- this was
-- always an integrity bypass, never a privilege-escalation angle.)
--
-- #191 N1/N2 -- the claiming INSERT below is `ON CONFLICT ("key", work_item_id) DO
-- NOTHING`, not a bare INSERT: re-inserting the EXACT SAME (key, work_item_id) pair this
-- trigger (or an earlier run of it) already committed is a no-op instead of a spurious
-- `23505`. A conflict on a DIFFERENT unique index -- the PRIMARY KEY on `key` alone, e.g.
-- a different work_item_id claiming the same key -- is NOT suppressed by this clause and
-- still fails exactly as before; only an exact match on the named (key, work_item_id)
-- target is inferred. Two reasons, both proven live:
--   - N2: this trigger is `BEFORE INSERT OR UPDATE OF "key"`, and Postgres fires an
--     `UPDATE OF <col>` trigger whenever that column is MENTIONED in `SET`, not when its
--     value actually changes. A whole-row-style `UPDATE ... SET key = $1, title = $2`
--     that re-sends `key`'s own current, unchanged value -- an entirely ordinary thing
--     for an ORM's generic update helper to do -- used to re-attempt the identical claim
--     row and fail outright. Now it no-ops and the update proceeds.
--   - N1: a `work_item` INSERT that the CALLER's own `ON CONFLICT ... DO NOTHING` (the
--     idiom already used at several call sites in this codebase) silently skips still
--     runs this BEFORE trigger first -- its claim insert is not, and cannot be, rolled
--     back by a skip decided after it already ran. Without this clause, that claim row
--     permanently squats its key string: nothing ever un-claims it (by this table's own
--     "forever claimed" design in schema.ts), and even the work item it names could never
--     claim it later, because re-claiming it would hit the exact same unconditional
--     insert and fail. With this clause, that specific work_item_id CAN still legitimately
--     take that exact key later (e.g. a corrective rekey) without error -- the squat is no
--     longer a dead end, only a claim that already happened once. A DIFFERENT
--     work_item_id still can never take it, unchanged from before.
-- See #191's regression tests in `work-item-schema-integrity.test.ts` for both scenarios,
-- proven against the trigger both before and after this clause.
CREATE OR REPLACE FUNCTION work_item_claim_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.work_item_key_claim ("key", work_item_id)
  VALUES (NEW."key", NEW.id)
  ON CONFLICT ("key", work_item_id) DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_item_claim_key
  BEFORE INSERT OR UPDATE OF "key" ON "work_item"
  FOR EACH ROW
  EXECUTE FUNCTION work_item_claim_key();
