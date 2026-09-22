CREATE TABLE "instance_setting" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"setup_completed_at" timestamp,
	"setup_token_hash" text,
	"setup_token_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
