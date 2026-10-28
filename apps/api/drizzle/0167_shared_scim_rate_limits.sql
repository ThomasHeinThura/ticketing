CREATE TABLE "request_rate_limit_counter" (
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_rate_limit_counter_bucket_key_hash_pk" PRIMARY KEY("bucket","key_hash"),
	CONSTRAINT "request_rate_limit_counter_bucket_check" CHECK ("request_rate_limit_counter"."bucket" IN ('anonymous_scim_failure', 'scim_connection')),
	CONSTRAINT "request_rate_limit_counter_hash_check" CHECK ("request_rate_limit_counter"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "request_rate_limit_counter_count_check" CHECK ("request_rate_limit_counter"."count" >= 0),
	CONSTRAINT "request_rate_limit_counter_expiry_check" CHECK ("request_rate_limit_counter"."expires_at" > "request_rate_limit_counter"."window_started_at")
);
--> statement-breakpoint
CREATE INDEX "request_rate_limit_counter_expires_idx" ON "request_rate_limit_counter" USING btree ("expires_at");