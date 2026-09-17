ALTER TABLE "work_item" DROP CONSTRAINT "work_item_state_id_state_id_fk";
--> statement-breakpoint
ALTER TABLE "work_item" DROP CONSTRAINT "work_item_parent_id_work_item_id_fk";
--> statement-breakpoint
ALTER TABLE "work_item" ALTER COLUMN "customer_visibility" SET DEFAULT 'private';--> statement-breakpoint
ALTER TABLE "work_item" ALTER COLUMN "customer_visibility" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "state" ADD CONSTRAINT "state_project_id_id_unique" UNIQUE("project_id","id");--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_id_id_unique" UNIQUE("project_id","id");--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_id_state_id_state_project_id_id_fk" FOREIGN KEY ("project_id","state_id") REFERENCES "public"."state"("project_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "work_item" ADD CONSTRAINT "work_item_project_id_parent_id_work_item_project_id_id_fk" FOREIGN KEY ("project_id","parent_id") REFERENCES "public"."work_item"("project_id","id") ON DELETE restrict ON UPDATE cascade;
--> statement-breakpoint
-- #186 S5, hand-written (drizzle-kit's schema DSL has no trigger primitive; appended
-- into this generated migration per docs/04-engineering/migrations.md's "hand-written
-- SQL is appended into a generated migration file" convention, the same place this
-- doc already earmarks for the future work_item.key assignment trigger).
--
-- work_item_key_alias.old_key and work_item.key are otherwise independent namespaces:
-- nothing stops an alias being created whose old_key equals a currently-LIVE
-- work_item.key (reachable when a work item moves between projects and a different
-- project's key gets reused after deletion -- proven live by the Opus review of PR
-- #185). work_item.key's own unique index does not exclude archived/soft-deleted rows,
-- so "currently-live" here means simply "any row that exists in work_item.key" --
-- exactly what this trigger checks. A plain UNIQUE/CHECK constraint cannot compare one
-- table's column against a DIFFERENT table's column in Postgres, so this needs a
-- trigger rather than a declarative constraint -- more robust than an
-- application-level check alone against any future direct-SQL write path, at the cost
-- of one more piece of DB-side logic to keep in sync with the schema.
--
-- This closes ONE direction only: an alias's old_key must not collide with a
-- currently-live work_item.key. It deliberately does NOT check the reverse (a NEW
-- work_item.key value colliding with an existing alias's old_key) -- that is a
-- different, related concern outside #186's three findings and is not touched here.
CREATE OR REPLACE FUNCTION work_item_key_alias_reject_live_collision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "work_item" WHERE "key" = NEW."old_key") THEN
    RAISE EXCEPTION 'work_item_key_alias.old_key "%" collides with a currently-live work_item.key', NEW."old_key"
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_item_key_alias_reject_live_collision
  BEFORE INSERT OR UPDATE OF "old_key" ON "work_item_key_alias"
  FOR EACH ROW
  EXECUTE FUNCTION work_item_key_alias_reject_live_collision();
