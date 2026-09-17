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
-- assignment" section for how the future rekey/assignment trigger must sequence against
-- this one.
--
-- `SET search_path = pg_catalog, public` and the fully-qualified `public.work_item_key_claim`
-- reference are deliberate (#191 O3, found on #186 S5's original trigger and fixed here
-- from the start rather than repeated): an unqualified `work_item_key_claim` would
-- resolve against a session-local `CREATE TEMP TABLE work_item_key_claim (...)` ahead of
-- the real one on `search_path`'s default order, silently defeating this claim on any
-- session that has one — an integrity bypass, not a privilege-escalation angle
-- (`SECURITY INVOKER`, the default here, is correct either way).
CREATE OR REPLACE FUNCTION work_item_claim_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.work_item_key_claim ("key", work_item_id)
  VALUES (NEW."key", NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_item_claim_key
  BEFORE INSERT OR UPDATE OF "key" ON "work_item"
  FOR EACH ROW
  EXECUTE FUNCTION work_item_claim_key();
