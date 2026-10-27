-- 0206_feature_flag_upgrade_defaults: owner decision (features.md defaults). Hand-written and idempotent.
-- `feature.sla`, `feature.customer_portal`, `feature.timeline` and `feature.calendar` default to off
-- and are now enforced at runtime. An installation that already holds data used them while they
-- were unenforced, so it keeps them: an enabled, unlocked instance row is written for each flag
-- that has no instance row yet. A fresh install (no workspace at migration time) gets no row and
-- keeps the documented default. An existing instance row (an administrator's explicit choice)
-- and every workspace or project override are left untouched.
INSERT INTO "instance_feature_flag" ("feature_key", "enabled")
SELECT flag.feature_key, true
FROM (VALUES
  ('feature.sla'),
  ('feature.customer_portal'),
  ('feature.timeline'),
  ('feature.calendar')
) AS flag(feature_key)
WHERE EXISTS (SELECT 1 FROM "workspace")
ON CONFLICT ("feature_key") DO NOTHING;
