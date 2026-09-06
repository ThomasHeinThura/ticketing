-- Issue #6 — drop the inherited kaneo billing tables.
--
-- kaneo's billing provider is Creem, not Stripe. TaskDesk is self-hosted and
-- ships no billing: entitlement checks, seat reconciliation, trial grants and
-- the reminder scheduler all leave with these tables.
--
-- No ordering hazard here, unlike 0046: nothing outside this set references
-- them, so these are plain drops rather than a constraint-then-table sequence.
DROP TABLE IF EXISTS "billing_event" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "billing_reminder_sent" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "trial_grant" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_billing" CASCADE;
