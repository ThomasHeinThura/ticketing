CREATE TABLE "customer_invitation_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"invitation_id" text NOT NULL,
	"credential_hash" text,
	"resend" boolean DEFAULT false NOT NULL,
	"envelope" text,
	"state" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lease_id" uuid,
	"lease_expires_at" timestamp with time zone,
	"terminal_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_invitation_delivery_state_check" CHECK ("customer_invitation_delivery"."state" IN ('queued', 'sending', 'sent', 'suppressed', 'failed')),
	CONSTRAINT "customer_invitation_delivery_attempts_check" CHECK ("customer_invitation_delivery"."attempts" BETWEEN 0 AND 3),
	CONSTRAINT "customer_invitation_delivery_expiry_check" CHECK ("customer_invitation_delivery"."expires_at" >= "customer_invitation_delivery"."created_at" AND "customer_invitation_delivery"."expires_at" <= "customer_invitation_delivery"."created_at" + INTERVAL '15 minutes'),
	CONSTRAINT "customer_invitation_delivery_state_shape_check" CHECK ((
        ("customer_invitation_delivery"."state" = 'queued' AND "customer_invitation_delivery"."envelope" IS NOT NULL AND "customer_invitation_delivery"."credential_hash" IS NOT NULL AND "customer_invitation_delivery"."lease_id" IS NULL AND "customer_invitation_delivery"."lease_expires_at" IS NULL AND "customer_invitation_delivery"."terminal_code" IS NULL)
        OR ("customer_invitation_delivery"."state" = 'sending' AND "customer_invitation_delivery"."envelope" IS NOT NULL AND "customer_invitation_delivery"."credential_hash" IS NOT NULL AND "customer_invitation_delivery"."lease_id" IS NOT NULL AND "customer_invitation_delivery"."lease_expires_at" IS NOT NULL AND "customer_invitation_delivery"."terminal_code" IS NULL)
        OR ("customer_invitation_delivery"."state" = 'suppressed' AND "customer_invitation_delivery"."envelope" IS NULL AND "customer_invitation_delivery"."credential_hash" IS NULL AND "customer_invitation_delivery"."lease_id" IS NULL AND "customer_invitation_delivery"."lease_expires_at" IS NULL AND "customer_invitation_delivery"."terminal_code" IN ('inert', 'expired', 'revoked', 'accepted', 'rejected', 'superseded'))
        OR ("customer_invitation_delivery"."state" = 'sent' AND "customer_invitation_delivery"."envelope" IS NULL AND "customer_invitation_delivery"."credential_hash" IS NULL AND "customer_invitation_delivery"."lease_id" IS NULL AND "customer_invitation_delivery"."lease_expires_at" IS NULL AND "customer_invitation_delivery"."terminal_code" = 'sent')
        OR ("customer_invitation_delivery"."state" = 'failed' AND "customer_invitation_delivery"."envelope" IS NULL AND "customer_invitation_delivery"."credential_hash" IS NULL AND "customer_invitation_delivery"."lease_id" IS NULL AND "customer_invitation_delivery"."lease_expires_at" IS NULL AND "customer_invitation_delivery"."terminal_code" IN ('provider_rejected', 'envelope_unavailable', 'retry_exhausted'))
      )),
	CONSTRAINT "customer_invitation_delivery_terminal_code_check" CHECK ("customer_invitation_delivery"."terminal_code" IS NULL OR "customer_invitation_delivery"."terminal_code" IN ('inert', 'sent', 'provider_rejected', 'envelope_unavailable', 'expired', 'revoked', 'accepted', 'rejected', 'superseded', 'retry_exhausted'))
);
--> statement-breakpoint
ALTER TABLE "customer_invitation_delivery" ADD CONSTRAINT "customer_invitation_delivery_invitation_id_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_invitation_delivery_generation_unique" ON "customer_invitation_delivery" USING btree ("invitation_id","credential_hash") WHERE "customer_invitation_delivery"."credential_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "customer_invitation_delivery_due_idx" ON "customer_invitation_delivery" USING btree ("next_attempt_at","expires_at") WHERE "customer_invitation_delivery"."state" IN ('queued', 'sending');--> statement-breakpoint
CREATE INDEX "customer_invitation_delivery_invitation_idx" ON "customer_invitation_delivery" USING btree ("invitation_id");