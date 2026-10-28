-- 0209_feature_flag_upgrade_seeded_rows: completes 0206 (owner decision, features.md defaults).
-- Hand-written and idempotent. Migration 0096 seeded an instance row for every flag, so on a real
-- installation the four newly enforced flags already have a row (enabled = false, version 1, no
-- updated_by) and 0206's ON CONFLICT DO NOTHING left them off, which closed the customer portal
-- and SLA on upgrade. A row still exactly as 0096 seeded it was never chosen by an administrator,
-- so on an installation that already holds a workspace it is switched on. A row an administrator
-- has written (version > 1 or updated_by set), a locked row, every workspace or project override,
-- and a fresh install (no workspace at migration time) are left untouched.
UPDATE "instance_feature_flag"
SET "enabled" = true,
  "version" = "version" + 1,
  "updated_at" = now()
WHERE "feature_key" IN (
    'feature.sla',
    'feature.customer_portal',
    'feature.timeline',
    'feature.calendar'
  )
  AND "enabled" = false
  AND "locked" = false
  AND "version" = 1
  AND "updated_by" IS NULL
  AND EXISTS (SELECT 1 FROM "workspace");
