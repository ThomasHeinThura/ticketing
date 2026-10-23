CREATE TABLE "notification_preference_handoff" (
	"handle_hash" "bytea" PRIMARY KEY NOT NULL,
	"audience" text NOT NULL,
	"recipient_person_id" text NOT NULL,
	"event_kind" text NOT NULL,
	"channel" text NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "notification_preference_handoff_hash_check" CHECK (octet_length("notification_preference_handoff"."handle_hash") = 32),
	CONSTRAINT "notification_preference_handoff_audience_check" CHECK ("notification_preference_handoff"."audience" IN ('agent', 'customer')),
	CONSTRAINT "notification_preference_handoff_scope_check" CHECK (("notification_preference_handoff"."scope" = 'global' AND "notification_preference_handoff"."scope_id" IS NULL) OR ("notification_preference_handoff"."scope" IN ('workspace', 'project') AND "notification_preference_handoff"."scope_id" IS NOT NULL)),
	CONSTRAINT "notification_preference_handoff_expiry_check" CHECK ("notification_preference_handoff"."expires_at" = "notification_preference_handoff"."created_at" + interval '10 minutes')
);
--> statement-breakpoint
ALTER TABLE "notification_preference_handoff" ADD CONSTRAINT "notification_preference_handoff_recipient_person_id_person_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."person"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_preference_handoff_expiry_idx" ON "notification_preference_handoff" USING btree ("expires_at");