CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"organisation_id" text,
	"work_item_id" text,
	"comment_id" text,
	"submission_id" text,
	"object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" bigint NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"customer_visible" boolean DEFAULT false NOT NULL,
	"uploaded_by" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attachment_state_allowed" CHECK ("attachment"."state" in ('pending', 'ready', 'deleted')),
	CONSTRAINT "attachment_exactly_one_parent" CHECK ((
        (case when "attachment"."work_item_id" is not null then 1 else 0 end) +
        (case when "attachment"."comment_id" is not null then 1 else 0 end) +
        (case when "attachment"."submission_id" is not null then 1 else 0 end)
      ) = 1)
);
--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "attachment_max_bytes" integer DEFAULT 26214400 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "attachment_max_per_item" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "instance_setting" ADD COLUMN "attachment_allowed_extensions" text[] DEFAULT ARRAY[
        'jpg','jpeg','png','gif','webp','heic','heif','bmp','tiff',
        'pdf','doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp',
        'txt','csv','md','json','log','rtf'
      ]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_organisation_id_organisation_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisation"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploaded_by_person_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."person"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_workspace_id_work_item_id_work_item_workspace_id_id_fk" FOREIGN KEY ("workspace_id","work_item_id") REFERENCES "public"."work_item"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_workItemId_idx" ON "attachment" USING btree ("work_item_id");--> statement-breakpoint
CREATE INDEX "attachment_workspaceId_idx" ON "attachment" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "attachment_pending_idx" ON "attachment" USING btree ("state") WHERE "attachment"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "attachment_workspaceId_state_idx" ON "attachment" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "attachment_organisationId_idx" ON "attachment" USING btree ("organisation_id") WHERE "attachment"."organisation_id" is not null;