-- 0204_p2_intake_fixes: P2 round-1 review fixes (intake lane). Hand-written and idempotent.
-- P2R1-05 (IQ-15): the clarification-window auto-decline writes a system thread message. A
-- system message has no person author, carries a stable reason code with its parameters (so
-- each reader renders it in their own locale) and the English text it was rendered with.
ALTER TABLE "submission_message" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_message" ADD COLUMN IF NOT EXISTS "reason_code" text;--> statement-breakpoint
ALTER TABLE "submission_message" ADD COLUMN IF NOT EXISTS "reason_params" jsonb;--> statement-breakpoint
ALTER TABLE "submission_message" DROP CONSTRAINT IF EXISTS "submission_message_actor_type_allowed";--> statement-breakpoint
ALTER TABLE "submission_message" ADD CONSTRAINT "submission_message_actor_type_allowed" CHECK ("submission_message"."actor_type" IN ('customer', 'triager', 'system'));--> statement-breakpoint
ALTER TABLE "submission_message" DROP CONSTRAINT IF EXISTS "submission_message_system_author";--> statement-breakpoint
ALTER TABLE "submission_message" ADD CONSTRAINT "submission_message_system_author" CHECK (("submission_message"."actor_type" = 'system') = ("submission_message"."author_id" IS NULL));--> statement-breakpoint
ALTER TABLE "submission_message" DROP CONSTRAINT IF EXISTS "submission_message_reason_code_allowed";--> statement-breakpoint
ALTER TABLE "submission_message" ADD CONSTRAINT "submission_message_reason_code_allowed" CHECK (("submission_message"."reason_code" IS NULL AND "submission_message"."reason_params" IS NULL) OR ("submission_message"."actor_type" = 'system' AND "submission_message"."reason_code" IN ('clarification_window_expired')));
