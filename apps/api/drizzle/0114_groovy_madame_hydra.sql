CREATE TABLE "notification_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"recipient_person_id" text NOT NULL,
	"channel" text NOT NULL,
	"workspace_id" text NOT NULL,
	"organisation_id" text,
	"dedupe_key" text NOT NULL,
	"digest_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_delivery_event_recipient_channel_unique" UNIQUE("event_id","recipient_person_id","channel"),
	CONSTRAINT "notification_delivery_channel_check" CHECK ("notification_delivery"."channel" like 'notify.%'),
	CONSTRAINT "notification_delivery_state_check" CHECK ("notification_delivery"."state" in ('pending', 'delivered', 'dead', 'suppressed')),
	CONSTRAINT "notification_delivery_attempts_check" CHECK ("notification_delivery"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_digest" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_person_id" text NOT NULL,
	"channel" text NOT NULL,
	"workspace_id" text NOT NULL,
	"organisation_id" text,
	"cadence" text NOT NULL,
	"timezone" text NOT NULL,
	"window_start_at" timestamp NOT NULL,
	"window_end_at" timestamp NOT NULL,
	"state" text DEFAULT 'collecting' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"last_error" text,
	"payload_hash" text,
	"lease_token" uuid,
	"lease_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digest_partition_unique" UNIQUE NULLS NOT DISTINCT("recipient_person_id","channel","workspace_id","organisation_id","cadence","window_start_at","window_end_at"),
	CONSTRAINT "notification_digest_channel_check" CHECK ("notification_digest"."channel" like 'notify.%'),
	CONSTRAINT "notification_digest_cadence_check" CHECK ("notification_digest"."cadence" in ('hourly', 'daily')),
	CONSTRAINT "notification_digest_state_check" CHECK ("notification_digest"."state" in ('collecting', 'pending', 'delivered', 'dead', 'suppressed')),
	CONSTRAINT "notification_digest_attempts_check" CHECK ("notification_digest"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_preference" (
	"person_id" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"channel" text NOT NULL,
	"event_kind" text NOT NULL,
	"enabled" boolean NOT NULL,
	"digest" text DEFAULT 'off' NOT NULL,
	CONSTRAINT "notification_preference_person_scope_channel_event_unique" UNIQUE NULLS NOT DISTINCT("person_id","scope","scope_id","channel","event_kind"),
	CONSTRAINT "notification_preference_scope_check" CHECK (("notification_preference"."scope" = 'global' and "notification_preference"."scope_id" is null) or ("notification_preference"."scope" in ('workspace', 'project') and "notification_preference"."scope_id" is not null)),
	CONSTRAINT "notification_preference_channel_check" CHECK ("notification_preference"."channel" = 'in_app' or "notification_preference"."channel" like 'notify.%'),
	CONSTRAINT "notification_preference_digest_check" CHECK ("notification_preference"."digest" in ('off', 'hourly', 'daily'))
);
--> statement-breakpoint
CREATE TABLE "outbox_dedupe_reservation" (
	"reservation_key" "bytea" PRIMARY KEY NOT NULL,
	"recipient_person_id" text NOT NULL,
	"channel" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"owner_delivery_id" text NOT NULL,
	"lease_token" uuid NOT NULL,
	"lease_expires_at" timestamp NOT NULL,
	CONSTRAINT "outbox_dedupe_reservation_tuple_unique" UNIQUE("recipient_person_id","channel","dedupe_key"),
	CONSTRAINT "outbox_dedupe_reservation_key_length" CHECK (octet_length("outbox_dedupe_reservation"."reservation_key") = 32)
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "event_id" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "body" text;--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "read_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_event_id_outbox_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."outbox"("event_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_digest_id_notification_digest_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."notification_digest"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_digest" ADD CONSTRAINT "notification_digest_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_digest" ADD CONSTRAINT "notification_digest_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_digest" ADD CONSTRAINT "notification_digest_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD CONSTRAINT "notification_preference_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "outbox_dedupe_reservation" ADD CONSTRAINT "outbox_dedupe_reservation_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "outbox_dedupe_reservation" ADD CONSTRAINT "outbox_dedupe_reservation_owner_delivery_id_notification_delivery_id_fk" FOREIGN KEY ("owner_delivery_id") REFERENCES "public"."notification_delivery"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "notification_delivery_state_next_attempt_idx" ON "notification_delivery" USING btree ("state","next_attempt_at") WHERE "notification_delivery"."state" = 'pending' and "notification_delivery"."digest_id" is null;--> statement-breakpoint
CREATE INDEX "notification_delivery_workspace_state_idx" ON "notification_delivery" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "notification_delivery_digest_idx" ON "notification_delivery" USING btree ("digest_id");--> statement-breakpoint
CREATE INDEX "notification_delivery_recent_success_idx" ON "notification_delivery" USING btree ("recipient_person_id","channel","dedupe_key","delivered_at") WHERE "notification_delivery"."delivered_at" is not null;--> statement-breakpoint
CREATE INDEX "notification_digest_due_idx" ON "notification_digest" USING btree ("state","next_attempt_at") WHERE "notification_digest"."state" in ('collecting', 'pending');--> statement-breakpoint
CREATE INDEX "notification_preference_person_event_idx" ON "notification_preference" USING btree ("person_id","event_kind");--> statement-breakpoint
CREATE INDEX "outbox_dedupe_reservation_expiry_idx" ON "outbox_dedupe_reservation" USING btree ("lease_expires_at");--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_person_id_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "notification_person_id_idx" ON "notification" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_event_person_unique" ON "notification" USING btree ("event_id","person_id") WHERE "notification"."event_id" is not null;