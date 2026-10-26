ALTER TABLE "saved_view" ADD COLUMN "queue_pair_id" text;--> statement-breakpoint
ALTER TABLE "saved_view" ADD COLUMN "queue_version" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "saved_view_queue_pair_entity_unique" ON "saved_view" USING btree ("workspace_id","queue_pair_id",("query"->>'entity')) WHERE "saved_view"."queue_pair_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_queue_pair_shape" CHECK ((queue_pair_id IS NULL AND queue_version IS NULL) OR (queue_pair_id IS NOT NULL AND length(queue_pair_id) BETWEEN 1 AND 128 AND coalesce(query->>'entity', '') IN ('submission', 'work_item') AND queue_version IS NOT NULL AND queue_version >= 1 AND queue_version <= 9007199254740991));
--> statement-breakpoint
-- All writers, including ordinary saved-view updates, advance paired-view fences.
CREATE FUNCTION taskdesk_saved_view_queue_fence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.queue_pair_id IS NULL THEN
    NEW.queue_version := NULL;
  ELSE
    NEW.queue_version := COALESCE(OLD.queue_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER taskdesk_saved_view_queue_fence
BEFORE UPDATE ON saved_view
FOR EACH ROW EXECUTE FUNCTION taskdesk_saved_view_queue_fence();
