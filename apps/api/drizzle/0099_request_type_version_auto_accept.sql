ALTER TABLE "request_type_version" ADD COLUMN "auto_accept" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE "request_type_version" AS version SET "auto_accept" = request_type."auto_accept" FROM "request_type" WHERE request_type.id = version.request_type_id AND request_type.version = version.number;
