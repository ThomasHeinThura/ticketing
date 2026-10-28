CREATE TABLE work_item_relation (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES work_item(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  target_id text NOT NULL REFERENCES work_item(id) ON DELETE CASCADE ON UPDATE NO ACTION,
  type text NOT NULL CHECK (type IN ('relates', 'blocks', 'duplicates', 'precedes', 'requires')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_item_relation_not_self_check CHECK (source_id <> target_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX work_item_relation_directed_unique ON work_item_relation(source_id, target_id, type);
--> statement-breakpoint
CREATE UNIQUE INDEX work_item_relation_relates_unique ON work_item_relation(least(source_id,target_id), greatest(source_id,target_id)) WHERE type = 'relates';
--> statement-breakpoint
CREATE INDEX work_item_relation_target_idx ON work_item_relation(target_id);
--> statement-breakpoint
CREATE FUNCTION work_item_relation_same_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_workspace text; target_workspace text;
BEGIN
  -- Stable order matches application endpoint locks and closes concurrent tenant moves.
  PERFORM id FROM work_item WHERE id IN (NEW.source_id, NEW.target_id) ORDER BY id FOR KEY SHARE;
  SELECT workspace_id INTO source_workspace FROM work_item WHERE id = NEW.source_id;
  SELECT workspace_id INTO target_workspace FROM work_item WHERE id = NEW.target_id;
  IF source_workspace IS NULL OR target_workspace IS NULL OR source_workspace <> target_workspace THEN
    RAISE EXCEPTION 'Relation endpoints must share a workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_item_relation_same_workspace_trigger BEFORE INSERT OR UPDATE ON work_item_relation FOR EACH ROW EXECUTE FUNCTION work_item_relation_same_workspace();
--> statement-breakpoint
CREATE FUNCTION work_item_relation_preserve_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id AND EXISTS (
    SELECT 1 FROM work_item_relation r JOIN work_item peer ON peer.id = CASE WHEN r.source_id = OLD.id THEN r.target_id ELSE r.source_id END
    WHERE (r.source_id = OLD.id OR r.target_id = OLD.id) AND peer.workspace_id <> NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'Relation endpoints must share a workspace' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_item_relation_preserve_workspace_trigger BEFORE UPDATE OF workspace_id ON work_item FOR EACH ROW EXECUTE FUNCTION work_item_relation_preserve_workspace();
