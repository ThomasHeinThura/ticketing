-- 0153_p5_customer_invitations: customer-scope invitations on the existing `invitation` row
-- (feature-contracts-p3.md CP-20..CP-26, decided 23 Oct). Hand-written and idempotent: every
-- statement is guarded, nothing is dropped or rewritten, and existing rows stay valid.
--
-- `scope` discriminates the staff flow (default, every existing row) from the customer flow. A
-- customer-scope row names exactly one customer organisation and the `customer` role, and carries
-- a hash-only accept credential (never the credential itself). `workspace_id` stays populated on
-- customer rows: the inviter's `member:invite` authority and reach are workspace-scoped, and the
-- existing revoke route resolves authority from it.
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "scope" text DEFAULT 'staff' NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "organisation_id" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "credential_hash" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "last_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN IF NOT EXISTS "accepted_person_id" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_scope_allowed') THEN
    ALTER TABLE "invitation" ADD CONSTRAINT "invitation_scope_allowed" CHECK (scope IN ('staff', 'customer')) NOT VALID;
  END IF;
  -- A staff row never carries an organisation or a credential; a customer row always names an
  -- organisation and the customer role (the schema-level half of CP-21's double validation).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_scope_shape') THEN
    ALTER TABLE "invitation" ADD CONSTRAINT "invitation_scope_shape" CHECK (
      (scope = 'staff' AND organisation_id IS NULL AND credential_hash IS NULL)
      OR (scope = 'customer' AND organisation_id IS NOT NULL AND role = 'customer' AND team_id IS NULL)
    ) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_organisation_id_organisation_id_fk') THEN
    ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE cascade NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitation_accepted_person_id_person_id_fk') THEN
    ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_person_id_person_id_fk" FOREIGN KEY ("accepted_person_id") REFERENCES "public"."person"("id") ON DELETE set null ON UPDATE cascade NOT VALID;
  END IF;
END $$;--> statement-breakpoint
-- Existing rows are all staff-scope with null new columns, so each constraint validates at once.
ALTER TABLE "invitation" VALIDATE CONSTRAINT "invitation_scope_allowed";--> statement-breakpoint
ALTER TABLE "invitation" VALIDATE CONSTRAINT "invitation_scope_shape";--> statement-breakpoint
ALTER TABLE "invitation" VALIDATE CONSTRAINT "invitation_organisation_id_organisation_id_fk";--> statement-breakpoint
ALTER TABLE "invitation" VALIDATE CONSTRAINT "invitation_accepted_person_id_person_id_fk";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invitation_credential_hash_unique" ON "invitation" USING btree ("credential_hash") WHERE credential_hash IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invitation_organisation_idx" ON "invitation" USING btree ("organisation_id") WHERE organisation_id IS NOT NULL;--> statement-breakpoint
-- One pending customer invitation per organisation and address (resend rotates it instead).
CREATE UNIQUE INDEX IF NOT EXISTS "invitation_customer_pending_unique" ON "invitation" USING btree ("organisation_id", lower("email")) WHERE scope = 'customer' AND status = 'pending';
