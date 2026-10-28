CREATE TABLE "attachment_object_gc" (
	"object_key" text PRIMARY KEY NOT NULL,
	"source_workspace_id" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL
);
