ALTER TABLE "submission" DROP CONSTRAINT "submission_state_allowed";--> statement-breakpoint
ALTER TABLE "submission" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "submission" SET "submitted_at" = "created_at" WHERE "submitted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_submitted_at_state_consistent" CHECK (("submission"."state" = 'draft' and "submission"."submitted_at" is null) or ("submission"."state" <> 'draft' and "submission"."submitted_at" is not null));--> statement-breakpoint
ALTER TABLE "submission" ADD CONSTRAINT "submission_state_allowed" CHECK ("submission"."state" in ('draft', 'new', 'clarifying', 'accepted', 'declined', 'duplicate', 'withdrawn'));
