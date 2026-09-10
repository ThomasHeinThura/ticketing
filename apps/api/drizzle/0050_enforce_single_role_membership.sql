-- Issue #82 -- P0 security. "One workspace membership = exactly one role."
--
-- `workspace_member.role` is an unconstrained `text` column, and the still-mounted
-- better-auth `organization()` plugin comma-JOINS an array of roles into it while its own
-- evaluator comma-SPLITS the column back apart and ORs across the pieces. So a stored
-- "owner,admin" is the UNION of two roles to one evaluator and an unknown name to the other.
-- This migration is the third of the three controls that close that: the route guard refuses
-- to write such a value, the evaluator refuses to read one, and this makes the database
-- itself refuse to hold one.
--
-- THE RECOVERY STRATEGY, stated explicitly because issue #82 requires it to be:
--
--   1. REPAIR what can be repaired without deciding anyone's privileges. A value whose
--      comma-separated pieces all name the SAME role -- "admin,admin", "admin,", " admin " --
--      has exactly one meaning already, and collapsing it to that one role changes nobody's
--      access. This is done automatically, below.
--
--   2. REFUSE what cannot. A value naming two DIFFERENT roles -- "owner,admin" -- has no
--      correct automatic answer: keeping the higher role grants privileges nobody
--      deliberately granted, keeping the lower one silently demotes a member, and picking by
--      position is arbitrary. So this migration RAISES, names every offending row, and stops.
--      The deployment does not start until an operator assigns each of those members a single
--      role. That is a deliberate hard stop, and it is safe to make one: the application
--      already fails closed on these rows at read time (both `require-workspace-permission.ts`
--      and `/api/capabilities` refuse them), so the pressure to guess quickly is off. The
--      alternative -- guessing -- is how a privilege escalation becomes permanent and
--      invisible.
--
--      To find them before deploying:
--        SELECT id, workspace_id, user_id, role FROM workspace_member
--         WHERE position(',' in role) > 0 OR role <> btrim(role) OR btrim(role) = '';
--      To resolve one, assign the single role that member should have:
--        UPDATE workspace_member SET role = 'admin' WHERE id = '<id>';
--
--   3. CONSTRAIN, so the state cannot come back through a route nobody thought to guard --
--      including the native S7 role-write routes that land after this.
--
-- The repair rule here and `repairableMembershipRole()` in
-- `packages/permissions/src/membership-role-value.ts` are the same rule in two languages;
-- `membership-role-value.test.ts` pins that they agree.

UPDATE "workspace_member" AS m
SET "role" = r.only_role
FROM (
  SELECT s.id, min(s.segment) AS only_role
  FROM (
    SELECT wm.id, btrim(piece) AS segment
    FROM "workspace_member" wm,
         unnest(string_to_array(wm."role", ',')) AS piece
    WHERE btrim(piece) <> ''
  ) s
  GROUP BY s.id
  HAVING count(DISTINCT s.segment) = 1
) r
WHERE m.id = r.id AND m."role" IS DISTINCT FROM r.only_role;--> statement-breakpoint

DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(
           format('  member %s (workspace %s, user %s) holds %L', id, workspace_id, user_id, "role"),
           E'\n'
         )
    INTO offending
  FROM "workspace_member"
  WHERE position(',' in "role") > 0
     OR "role" <> btrim("role")
     OR btrim("role") = '';

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION E'Issue #82: % membership row(s) hold more than one role, and this migration will not choose which one to keep.\n%\nAssign each of these members exactly one role, then re-run the migration. See apps/api/drizzle/0050_enforce_single_role_membership.sql for the queries.',
      (SELECT count(*) FROM "workspace_member"
        WHERE position(',' in "role") > 0 OR "role" <> btrim("role") OR btrim("role") = ''),
      offending;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "workspace_member"
  ADD CONSTRAINT "workspace_member_role_single_value"
  CHECK (
    position(',' in "role") = 0
    AND "role" = btrim("role")
    AND btrim("role") <> ''
  );
