-- 0120 approval tenant anchor (owner decision 2026-10-10; migration-ledger.md "Still open").
-- approval had no workspace_id, so nothing stopped an approval pointing across tenants.
-- Add the column nullable, backfill it from the approval's own work item, then make it NOT
-- NULL and pin it to that work item with a composite FK. The parent key
-- work_item_workspace_id_id_unique (workspace_id, id) already exists, so none is added here.
ALTER TABLE "approval" ADD COLUMN "workspace_id" text;--> statement-breakpoint
UPDATE "approval" SET "workspace_id" = "work_item"."workspace_id" FROM "work_item" WHERE "work_item"."id" = "approval"."work_item_id";--> statement-breakpoint
ALTER TABLE "approval" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" DROP CONSTRAINT "approval_work_item_id_work_item_id_fk";
--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_workspace_work_item_fk" FOREIGN KEY ("workspace_id","work_item_id") REFERENCES "public"."work_item"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_workspaceId_idx" ON "approval" USING btree ("workspace_id");
