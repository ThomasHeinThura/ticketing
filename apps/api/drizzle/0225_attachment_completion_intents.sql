ALTER TABLE "attachment_object_gc" ADD COLUMN "attachment_id" text;--> statement-breakpoint
ALTER TABLE "attachment_object_gc" ADD COLUMN "storage_driver" text;--> statement-breakpoint
ALTER TABLE "attachment_object_gc" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "attachment_object_gc_attachment_id_idx" ON "attachment_object_gc" USING btree ("attachment_id") WHERE "attachment_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment_object_gc" ADD CONSTRAINT "attachment_object_gc_intent_shape" CHECK ((
  "attachment_id" IS NULL AND "storage_driver" IS NULL AND "retry_at" IS NULL
) OR (
  "attachment_id" IS NOT NULL
  AND "storage_driver" IS NOT NULL
  AND "retry_at" IS NOT NULL
  AND "source_workspace_id" IS NOT NULL
  AND "storage_driver" ~ '^(filesystem|s3):[0-9a-f]{16}$'
  AND "queued_at" = 'infinity'::timestamptz
));