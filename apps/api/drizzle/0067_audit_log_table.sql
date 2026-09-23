-- Issue #37, first slice: the `audit_log` table (data-model.md S11) and its append-only
-- enforcement. No route, no UI, no writer wiring into any mutation yet -- see
-- `apps/api/src/audit/audit-writer.ts` for the writer this table is built for.
--
-- Append-only mechanism, disclosed here since `AU-3`'s literal words ("the application's
-- own database role holds no UPDATE/DELETE grant on audit_log") describe a role split
-- this deployment does not provision: `compose.yml`/`charts/taskdesk`/`deploy/` create
-- exactly ONE Postgres role (`taskdesk`), which both runs every migration (so it OWNS
-- this table) and is what the running API connects as. A table owner keeps full DML
-- privileges regardless of any REVOKE -- only moving ownership to a second, lesser
-- role would make a grant restriction real, and provisioning that second role
-- (`taskdesk_app`/`taskdesk_maint`, per `docs/04-engineering/migrations.md`'s "Append-only
-- tables" section) is infrastructure work outside a schema-and-writer slice. So:
--   1. `REVOKE UPDATE, DELETE ... FROM PUBLIC` below is harmless, defense-in-depth for a
--      FUTURE lesser-privileged role, not what makes this table append-only today.
--   2. The actual, load-bearing control is `audit_log_append_only`, a `BEFORE UPDATE OR
--      DELETE` trigger that unconditionally raises -- enforced regardless of which role
--      issues the statement (short of a superuser disabling triggers, the same residual
--      risk `AU-15`'s hash chain exists to catch after the fact via `audit-verify`).
--
-- `seq` (`GENERATED ALWAYS AS IDENTITY`) is NOT in `data-model.md` S11's column list and
-- is NOT part of the hash input -- a genuine gap this implementation revealed, disclosed
-- in this PR's body and in `schema.ts`'s comment on this column: the writer needs a
-- race-free way to find "the current chain head" under `pg_advisory_xact_lock`-serialised
-- inserts, and `created_at` alone cannot guarantee that (finite timestamp resolution).
-- Same category of internal-ordering-only exception to "surrogate ids are never
-- sequential" that migration 0066 already established for `activity.seq`.
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_type" text NOT NULL,
	"api_key_id" text,
	"impersonator_id" text,
	"actor_ip" text,
	"user_agent" text,
	"trace_id" text,
	"workspace_id" text,
	"organisation_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prev_hash" text NOT NULL,
	"row_hash" text NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	CONSTRAINT "audit_log_seq_unique" UNIQUE("seq"),
	CONSTRAINT "audit_log_prev_hash_shape" CHECK ("audit_log"."prev_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "audit_log_row_hash_shape" CHECK ("audit_log"."row_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "audit_log_entity_type_entity_id_created_at_idx" ON "audit_log" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_workspace_id_created_at_idx" ON "audit_log" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Defense-in-depth only -- see the header comment above. A no-op against the table
-- OWNER (the only role that exists in this deployment shape today), real the moment a
-- second, lesser-privileged role is ever provisioned and used to connect the API.
REVOKE UPDATE, DELETE ON "audit_log" FROM PUBLIC;--> statement-breakpoint
-- `AU-7`: "Deleting an organisation tombstones its audit rows ... the mechanism is
-- `audit_log.organisation_id`'s `ON DELETE SET NULL` ... only the organisation link is
-- nulled." Postgres implements that FK action internally as an UPDATE on THIS table
-- (confirmed live: without the carve-out below, deleting a referenced `organisation`
-- row raised straight through this same trigger -- "audit_log is append-only: UPDATE is
-- not permitted"). So the append-only trigger must allow EXACTLY that one
-- system-generated update and nothing resembling it: `organisation_id` changing from
-- non-null to NULL, with every other column, including `organisation_id` changing to
-- anything other than NULL, byte-for-byte identical to OLD.
CREATE FUNCTION audit_log_reject_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.organisation_id IS DISTINCT FROM NEW.organisation_id THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
      OR NEW.actor_type IS DISTINCT FROM OLD.actor_type
      OR NEW.api_key_id IS DISTINCT FROM OLD.api_key_id
      OR NEW.impersonator_id IS DISTINCT FROM OLD.impersonator_id
      OR NEW.actor_ip IS DISTINCT FROM OLD.actor_ip
      OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
      OR NEW.trace_id IS DISTINCT FROM OLD.trace_id
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.action IS DISTINCT FROM OLD.action
      OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
      OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
      OR NEW.before IS DISTINCT FROM OLD.before
      OR NEW.after IS DISTINCT FROM OLD.after
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.prev_hash IS DISTINCT FROM OLD.prev_hash
      OR NEW.row_hash IS DISTINCT FROM OLD.row_hash
      OR NEW.seq IS DISTINCT FROM OLD.seq
    THEN
      RAISE EXCEPTION 'audit_log is append-only: UPDATE is not permitted beyond the AU-7 organisation_id tombstone (row id %)', OLD.id;
    END IF;
    IF NEW.organisation_id IS NOT NULL THEN
      RAISE EXCEPTION 'audit_log is append-only: organisation_id may only be set to NULL (the AU-7 tombstone), never reassigned (row id %)', OLD.id;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_log is append-only: % is not permitted (row id %)',
    TG_OP,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
END;
$$;--> statement-breakpoint
-- `AU-3`: "Append-only. No API can update or delete a row." This is the mechanism that
-- actually enforces it in this deployment shape (see header comment). Fires for every
-- role, including the table owner -- unlike a GRANT/REVOKE, a trigger is not bypassed
-- by ownership.
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_reject_mutation();--> statement-breakpoint
-- TRUNCATE closes the same hole a plain DELETE would, and `BEFORE UPDATE OR DELETE ...
-- FOR EACH ROW` above does NOT cover it: a `FOR EACH ROW` trigger never fires for
-- `TRUNCATE` at all (confirmed live -- three rows inserted, then `TRUNCATE audit_log`,
-- then zero rows, no error, the row-level trigger never ran), and the single owning
-- role in this deployment shape (see header comment) holds `TRUNCATE` privilege on its
-- own table regardless of any `REVOKE`, the same reasoning that makes the REVOKE below
-- defense-in-depth rather than the real control. `TRUNCATE` has no per-row concept
-- (no `OLD`/`NEW`, and AU-7's tombstone carve-out above is meaningless against it --
-- there is no row left to carve an exception for), so this is a SEPARATE function and a
-- SEPARATE `FOR EACH STATEMENT` trigger, not a branch added to
-- `audit_log_reject_mutation()` above.
CREATE FUNCTION audit_log_reject_truncate() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: TRUNCATE is not permitted';
END;
$$;--> statement-breakpoint
-- Defense-in-depth only -- see the header comment. A no-op against the table OWNER (the
-- only role that exists in this deployment shape today), real the moment a second,
-- lesser-privileged role is ever provisioned and used to connect the API. Same wording
-- as the `UPDATE, DELETE` revoke above, for the same reason.
REVOKE TRUNCATE ON "audit_log" FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER audit_log_append_only_truncate
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_log_reject_truncate();