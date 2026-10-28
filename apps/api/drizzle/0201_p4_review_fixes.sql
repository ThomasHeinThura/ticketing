-- 0201_p4_review_fixes: P4 round-1 review fixes. Hand-written and idempotent.
-- P4R1-H1: a webhook records when its destination or owner last changed, so a delivery created
-- for the previous destination or owner can never be replayed to the new one (WH-8, WH-14).
ALTER TABLE "webhook" ADD COLUMN IF NOT EXISTS "destination_changed_at" timestamp with time zone;
