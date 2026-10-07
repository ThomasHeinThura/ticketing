ALTER TABLE "service_calendar" ADD CONSTRAINT "service_calendar_workspace_id_id_unique" UNIQUE("workspace_id","id");
--> statement-breakpoint
CREATE TABLE "sla_goal" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"version_id" text NOT NULL,
	"metric" text NOT NULL,
	"work_item_type_id" text NOT NULL,
	"priority" text NOT NULL,
	"target_minutes" integer NOT NULL,
	CONSTRAINT "sla_goal_version_metric_type_priority_unique" UNIQUE("version_id","metric","work_item_type_id","priority"),
	CONSTRAINT "sla_goal_target_minutes_positive" CHECK ("sla_goal"."target_minutes" > 0),
	CONSTRAINT "sla_goal_metric_allowed" CHECK ("sla_goal"."metric" in ('first_response', 'resolution')),
	CONSTRAINT "sla_goal_priority_allowed" CHECK ("sla_goal"."priority" in ('low', 'medium', 'high', 'urgent'))
);
--> statement-breakpoint
CREATE TABLE "sla_policy" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active_version_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_policy_workspace_id_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "sla_policy_version_positive" CHECK ("sla_policy"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "sla_policy_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"number" integer NOT NULL,
	"calendar_id" text NOT NULL,
	"at_risk_threshold_pct" integer NOT NULL,
	"effective_from" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sla_policy_version_workspace_policy_id_unique" UNIQUE("workspace_id","policy_id","id"),
	CONSTRAINT "sla_policy_version_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "sla_policy_version_policy_id_unique" UNIQUE("policy_id","id"),
	CONSTRAINT "sla_policy_version_policy_number_unique" UNIQUE("policy_id","number"),
	CONSTRAINT "sla_policy_version_number_positive" CHECK ("sla_policy_version"."number" > 0),
	CONSTRAINT "sla_policy_version_threshold_allowed" CHECK ("sla_policy_version"."at_risk_threshold_pct" between 1 and 99)
);
--> statement-breakpoint
ALTER TABLE "sla_goal" ADD CONSTRAINT "sla_goal_workspace_version_fk" FOREIGN KEY ("workspace_id","version_id") REFERENCES "public"."sla_policy_version"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_goal" ADD CONSTRAINT "sla_goal_workspace_type_fk" FOREIGN KEY ("workspace_id","work_item_type_id") REFERENCES "public"."work_item_type"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_active_version_id_sla_policy_version_id_fk" FOREIGN KEY ("active_version_id") REFERENCES "public"."sla_policy_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policy_version" ADD CONSTRAINT "sla_policy_version_workspace_policy_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."sla_policy"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policy_version" ADD CONSTRAINT "sla_policy_version_workspace_calendar_fk" FOREIGN KEY ("workspace_id","calendar_id") REFERENCES "public"."service_calendar"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sla_policy_version_one_draft_unique" ON "sla_policy_version" USING btree ("policy_id") WHERE "sla_policy_version"."effective_from" is null;--> statement-breakpoint
ALTER TABLE "sla_policy"
  ADD CONSTRAINT "sla_policy_active_version_workspace_policy_fk"
  FOREIGN KEY ("workspace_id", "id", "active_version_id")
  REFERENCES "sla_policy_version"("workspace_id", "policy_id", "id");
--> statement-breakpoint
CREATE FUNCTION sla_policy_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.effective_from IS NOT NULL THEN
    RAISE EXCEPTION 'SLA policy versions must be created as drafts';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.effective_from IS NOT NULL THEN
      RAISE EXCEPTION 'Published SLA policy versions are immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.effective_from IS NOT NULL THEN
    RAISE EXCEPTION 'Published SLA policy versions are immutable';
  END IF;
  IF NEW.effective_from IS NOT NULL AND
     (NEW.id, NEW.workspace_id, NEW.policy_id, NEW.number, NEW.calendar_id,
      NEW.at_risk_threshold_pct, NEW.created_at) IS DISTINCT FROM
     (OLD.id, OLD.workspace_id, OLD.policy_id, OLD.number, OLD.calendar_id,
      OLD.at_risk_threshold_pct, OLD.created_at) THEN
    RAISE EXCEPTION 'Publishing cannot alter an SLA policy version';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sla_policy_version_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON sla_policy_version
  FOR EACH ROW EXECUTE FUNCTION sla_policy_version_guard();
--> statement-breakpoint
CREATE FUNCTION sla_goal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  version_id_to_check text;
  version_is_published boolean;
BEGIN
  version_id_to_check := CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END;
  SELECT effective_from IS NOT NULL INTO version_is_published
    FROM sla_policy_version WHERE id = version_id_to_check FOR UPDATE;
  IF version_is_published IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'SLA policy version not found';
  END IF;
  IF version_is_published THEN
    RAISE EXCEPTION 'Goals for a published SLA policy version are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.version_id <> OLD.version_id THEN
    SELECT effective_from IS NOT NULL INTO version_is_published
      FROM sla_policy_version WHERE id = NEW.version_id FOR UPDATE;
    IF version_is_published IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Goals can only be moved to a draft SLA policy version';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sla_goal_guard_trigger
  BEFORE INSERT OR UPDATE OR DELETE ON sla_goal
  FOR EACH ROW EXECUTE FUNCTION sla_goal_guard();
--> statement-breakpoint
CREATE FUNCTION sla_policy_active_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  included_types integer;
  complete_types integer;
BEGIN
  IF NEW.active_version_id IS NOT DISTINCT FROM OLD.active_version_id THEN
    RETURN NEW;
  END IF;
  IF NEW.active_version_id IS NULL THEN
    RAISE EXCEPTION 'An active SLA policy version cannot be cleared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM sla_policy_version
    WHERE id = NEW.active_version_id
      AND workspace_id = NEW.workspace_id
      AND policy_id = NEW.id
      AND effective_from IS NOT NULL
      AND number = (
        SELECT max(number) FROM sla_policy_version WHERE policy_id = NEW.id
      )
  ) THEN
    RAISE EXCEPTION 'Active SLA policy version must be the newest published version owned by the policy';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE goal_count = 8)
    INTO included_types, complete_types
    FROM (
      SELECT work_item_type_id, count(*) AS goal_count
      FROM sla_goal WHERE version_id = NEW.active_version_id
      GROUP BY work_item_type_id
    ) goals_by_type;
  IF included_types < 1 OR complete_types <> included_types THEN
    RAISE EXCEPTION 'Published SLA policy needs complete goal matrices for at least one type';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sla_policy_active_version_guard_trigger
  BEFORE UPDATE OF active_version_id ON sla_policy
  FOR EACH ROW EXECUTE FUNCTION sla_policy_active_version_guard();
