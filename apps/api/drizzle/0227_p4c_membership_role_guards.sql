-- Issue #181 -- database backstops for membership and role integrity (S3, S5, S6).
--
-- Forward-only and additive: it adds constraints and two triggers, and changes no row. A
-- preflight runs first and RAISES (naming the check and sample ids) if any existing row
-- would violate a new guard, so the migration never half-applies and never edits data.
-- Nothing is auto-repaired: a violating row is a tenant-isolation question for a person.
--
--   S3  membership.scope must equal its role's scope (composite FK role(id, scope)).
--   S5  closed vocabularies: person.side, membership.scope, role.scope,
--       organisation.default_customer_visibility.
--   S6  an import-created placeholder person (an unclaimed `import_placeholder_claim` row) can
--       never hold a membership, and a person who holds one can never be turned into a
--       placeholder. Deliberately NOT every `is_placeholder` row: a SCIM-provisioned person
--       who has not signed in yet is also `is_placeholder` and legitimately receives
--       group-mapped memberships (data-model.md: only import placeholders cannot hold one).
--   S7  membership.scope_id stays polymorphic; documented in data-model.md, not enforced here.
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(id, ', ') INTO bad FROM (SELECT id FROM "person" WHERE "side" NOT IN ('staff', 'customer') LIMIT 5) s;
  IF bad IS NOT NULL THEN RAISE EXCEPTION '#181 preflight: person.side outside (staff, customer), e.g. person ids: %', bad; END IF;

  SELECT string_agg(id, ', ') INTO bad FROM (SELECT id FROM "role" WHERE "scope" NOT IN ('instance', 'organisation', 'workspace', 'project') LIMIT 5) s;
  IF bad IS NOT NULL THEN RAISE EXCEPTION '#181 preflight: role.scope outside the closed vocabulary, e.g. role ids: %', bad; END IF;

  SELECT string_agg(id, ', ') INTO bad FROM (SELECT id FROM "membership" WHERE "scope" NOT IN ('instance', 'organisation', 'workspace', 'project') LIMIT 5) s;
  IF bad IS NOT NULL THEN RAISE EXCEPTION '#181 preflight: membership.scope outside the closed vocabulary, e.g. membership ids: %', bad; END IF;

  SELECT string_agg(id, ', ') INTO bad FROM (SELECT id FROM "organisation" WHERE "default_customer_visibility" NOT IN ('private', 'organisation') LIMIT 5) s;
  IF bad IS NOT NULL THEN RAISE EXCEPTION '#181 preflight: organisation.default_customer_visibility outside (private, organisation), e.g. organisation ids: %', bad; END IF;

  SELECT string_agg(m.id, ', ') INTO bad FROM (
    SELECT m.id FROM "membership" m JOIN "role" r ON r.id = m.role_id WHERE r.scope <> m.scope LIMIT 5
  ) m;
  IF bad IS NOT NULL THEN RAISE EXCEPTION '#181 preflight: membership.scope differs from its role scope, e.g. membership ids: %', bad; END IF;

  SELECT string_agg(m.id, ', ') INTO bad FROM (
    SELECT m.id FROM "membership" m JOIN "import_placeholder_claim" c ON c.person_id = m.person_id WHERE c.claimed_at IS NULL LIMIT 5
  ) m;
  IF bad IS NOT NULL THEN RAISE EXCEPTION '#181 preflight: import placeholder person holds a membership, e.g. membership ids: %', bad; END IF;
END $$;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_side_check" CHECK (side = ANY (ARRAY['staff'::text, 'customer'::text]));--> statement-breakpoint
ALTER TABLE "organisation" ADD CONSTRAINT "organisation_default_customer_visibility_check" CHECK (default_customer_visibility = ANY (ARRAY['private'::text, 'organisation'::text]));--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_scope_check" CHECK (scope = ANY (ARRAY['instance'::text, 'organisation'::text, 'workspace'::text, 'project'::text]));--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_scope_check" CHECK (scope = ANY (ARRAY['instance'::text, 'organisation'::text, 'workspace'::text, 'project'::text]));--> statement-breakpoint
ALTER TABLE "role" ADD CONSTRAINT "role_id_scope_unique" UNIQUE("id","scope");--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_role_scope_fk" FOREIGN KEY ("role_id","scope") REFERENCES "public"."role"("id","scope") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE FUNCTION "membership_reject_placeholder"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "import_placeholder_claim" WHERE "person_id" = NEW."person_id" AND "claimed_at" IS NULL) THEN
    RAISE EXCEPTION 'an import placeholder person cannot hold a membership (person %)', NEW."person_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "membership_reject_placeholder" BEFORE INSERT OR UPDATE OF "person_id" ON "membership" FOR EACH ROW EXECUTE FUNCTION "membership_reject_placeholder"();--> statement-breakpoint
CREATE FUNCTION "person_reject_placeholder_with_membership"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."is_placeholder" AND EXISTS (SELECT 1 FROM "membership" WHERE "person_id" = NEW."id") THEN
    RAISE EXCEPTION 'a person who holds a membership cannot become a placeholder (person %)', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "person_reject_placeholder_with_membership" BEFORE UPDATE OF "is_placeholder" ON "person" FOR EACH ROW EXECUTE FUNCTION "person_reject_placeholder_with_membership"();
