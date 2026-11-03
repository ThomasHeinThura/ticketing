-- 0216_document_link_register: the project Documents register (U-15, Thomas's decision of
-- 3 Nov 2026, "Pages and Documents are different"). Hand-written and idempotent.
--
-- * `kind`: the entry's type, one of contract | sow | design | handover | other. Existing rows
--   become `other`.
-- * `description`: an optional note of up to 2,000 characters.
-- * `updated_at`: set when an entry is edited (PATCH /api/project/{id}/document-links/{linkId}).
-- * Entries stay links, never copies. Uploaded attachments are not linked to an entry: the
--   `attachment` table's single-parent rule (work item, comment or submission) would have to
--   change first, which is a separate follow-up.
ALTER TABLE "document_link" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_link" ADD COLUMN IF NOT EXISTS "description" text;--> statement-breakpoint
ALTER TABLE "document_link" ADD COLUMN IF NOT EXISTS "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "document_link" DROP CONSTRAINT IF EXISTS "document_link_kind_check";--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_kind_check" CHECK ("document_link"."kind" IN ('contract', 'sow', 'design', 'handover', 'other'));--> statement-breakpoint
ALTER TABLE "document_link" DROP CONSTRAINT IF EXISTS "document_link_description_check";--> statement-breakpoint
ALTER TABLE "document_link" ADD CONSTRAINT "document_link_description_check" CHECK (char_length("document_link"."description") <= 2000);
