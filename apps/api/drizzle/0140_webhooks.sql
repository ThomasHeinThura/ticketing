-- P4 WH-1..WH-15: workspace webhooks and their delivery log. Additive; no backfill.
CREATE TABLE "webhook" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"secret_previous" text,
	"secret_rotated_at" timestamp with time zone,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"disabled_at" timestamp with time zone,
	"disabled_reason" text,
	"failing_since" timestamp with time zone,
	"last_error" text,
	"created_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_name_length" CHECK ((char_length(name) >= 1) AND (char_length(name) <= 120)),
	CONSTRAINT "webhook_url_length" CHECK ((char_length(url) >= 1) AND (char_length(url) <= 2048)),
	CONSTRAINT "webhook_events_nonempty" CHECK (cardinality(events) >= 1),
	CONSTRAINT "webhook_disabled_consistent" CHECK ((NOT active) OR (disabled_at IS NULL)),
	CONSTRAINT "webhook_version_positive" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_kind" text NOT NULL,
	"source" text DEFAULT 'event' NOT NULL,
	"redelivery_of" text,
	"project_id" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"status_code" integer,
	"duration_ms" integer,
	"request_body" jsonb,
	"response_body" text,
	"error" text,
	"attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_delivery_state_allowed" CHECK (state = ANY (ARRAY['pending'::text, 'delivered'::text, 'dead'::text, 'skipped_out_of_reach'::text, 'cancelled'::text])),
	CONSTRAINT "webhook_delivery_source_allowed" CHECK (source = ANY (ARRAY['event'::text, 'test'::text, 'redelivery'::text, 'automation'::text])),
	CONSTRAINT "webhook_delivery_attempt_nonnegative" CHECK (attempt >= 0)
);
--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_created_by_person_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhook"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "webhook_workspace_idx" ON "webhook" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "webhook_created_by_idx" ON "webhook" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_created_idx" ON "webhook_delivery" USING btree ("webhook_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_delivery_due_idx" ON "webhook_delivery" USING btree ("next_attempt_at") WHERE (state = 'pending'::text);--> statement-breakpoint
CREATE INDEX "webhook_delivery_created_at_idx" ON "webhook_delivery" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_event_unique" ON "webhook_delivery" USING btree ("webhook_id","event_id") WHERE (source = 'event'::text);
