ALTER TABLE "customer_invitation_delivery" DROP CONSTRAINT "customer_invitation_delivery_state_shape_check";--> statement-breakpoint
ALTER TABLE "customer_invitation_delivery" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
-- Legacy envelopes lack an ephemeral owner key. Erase them instead of making
-- a credential recoverable under the long-lived encryption key after upgrade.
UPDATE "customer_invitation_delivery"
SET "state" = 'failed', "terminal_code" = 'envelope_unavailable',
    "envelope" = NULL, "credential_hash" = NULL,
    "lease_id" = NULL, "lease_expires_at" = NULL,
    "updated_at" = clock_timestamp()
WHERE "state" IN ('queued', 'sending');--> statement-breakpoint
ALTER TABLE "customer_invitation_delivery" ADD CONSTRAINT "customer_invitation_delivery_state_shape_check" CHECK ((
        ("customer_invitation_delivery"."state" = 'queued' AND "customer_invitation_delivery"."envelope" IS NOT NULL AND "customer_invitation_delivery"."credential_hash" IS NOT NULL AND "customer_invitation_delivery"."owner_id" IS NOT NULL AND "customer_invitation_delivery"."lease_id" IS NULL AND "customer_invitation_delivery"."lease_expires_at" IS NULL AND "customer_invitation_delivery"."terminal_code" IS NULL)
        OR ("customer_invitation_delivery"."state" = 'sending' AND "customer_invitation_delivery"."envelope" IS NOT NULL AND "customer_invitation_delivery"."credential_hash" IS NOT NULL AND "customer_invitation_delivery"."owner_id" IS NOT NULL AND "customer_invitation_delivery"."lease_id" IS NOT NULL AND "customer_invitation_delivery"."lease_expires_at" IS NOT NULL AND "customer_invitation_delivery"."terminal_code" IS NULL)
        OR ("customer_invitation_delivery"."state" = 'suppressed' AND "customer_invitation_delivery"."envelope" IS NULL AND "customer_invitation_delivery"."credential_hash" IS NULL AND "customer_invitation_delivery"."owner_id" IS NULL AND "customer_invitation_delivery"."lease_id" IS NULL AND "customer_invitation_delivery"."lease_expires_at" IS NULL AND "customer_invitation_delivery"."terminal_code" IN ('inert', 'expired', 'revoked', 'accepted', 'rejected', 'superseded'))
        OR ("customer_invitation_delivery"."state" = 'sent' AND "customer_invitation_delivery"."envelope" IS NULL AND "customer_invitation_delivery"."credential_hash" IS NULL AND "customer_invitation_delivery"."owner_id" IS NULL AND "customer_invitation_delivery"."lease_id" IS NULL AND "customer_invitation_delivery"."lease_expires_at" IS NULL AND "customer_invitation_delivery"."terminal_code" = 'sent')
        OR ("customer_invitation_delivery"."state" = 'failed' AND "customer_invitation_delivery"."envelope" IS NULL AND "customer_invitation_delivery"."credential_hash" IS NULL AND "customer_invitation_delivery"."owner_id" IS NULL AND "customer_invitation_delivery"."lease_id" IS NULL AND "customer_invitation_delivery"."lease_expires_at" IS NULL AND "customer_invitation_delivery"."terminal_code" IN ('provider_rejected', 'envelope_unavailable', 'retry_exhausted'))
      ));
