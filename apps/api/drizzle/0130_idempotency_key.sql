CREATE TABLE "idempotency_key" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_key_actor_type_check" CHECK ("actor_type" = ANY (ARRAY['api_key'::text, 'user'::text])),
	CONSTRAINT "idempotency_key_state_check" CHECK ("state" = ANY (ARRAY['in_flight'::text, 'done'::text])),
	CONSTRAINT "idempotency_key_request_hash_check" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "idempotency_key_done_response_check" CHECK ((("state" = 'done') = ("response_status" IS NOT NULL AND "response_body" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_actor_key_unique" ON "idempotency_key" USING btree ("actor_type","actor_id","key");--> statement-breakpoint
CREATE INDEX "idempotency_key_expires_idx" ON "idempotency_key" USING btree ("expires_at");
