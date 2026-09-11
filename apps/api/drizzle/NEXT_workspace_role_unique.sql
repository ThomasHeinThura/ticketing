-- Issue #118 -- P0 data integrity. `workspace_role` has no UNIQUE (workspace_id, role).
--
-- THE DEFECT. `apps/api/src/database/schema.ts:238-262` declares two PLAIN indexes on the
-- table -- `workspace_role_workspaceId_idx` and `workspace_role_role_idx` -- and never a
-- `uniqueIndex`. Measured against a real PostgreSQL: two rows for one `(workspace_id, role)`
-- pair with DIFFERENT `permission` payloads insert cleanly. It is reachable without a race
-- because better-auth's `createOrgRole` performs no duplicate-name check at all.
--
-- WHY THAT MATTERS MORE THAN IT LOOKS. Both evaluators that read this table --
-- `customRoleStatements` (`require-workspace-permission.ts`) and `ownRoleStatements`
-- (`require-workspace-role-authority.ts`) -- select the role's permission set with
-- `.limit(1)` and NO `ORDER BY`. So for one member holding `manager`, the capability answer is
-- whichever row a heap scan returns first, and an unrelated `UPDATE` elsewhere can move rows
-- and reverse it. That is issue #66's fail-open shape and issue #82's malformed-value shape,
-- for a third table: the database permits a state the authorization logic assumes away.
--
-- THE RECOVERY STRATEGY, stated explicitly because the same question had to be answered for
-- `workspace_member.role` in migration `0050` and the ruling must be the same one:
--
--   1. REPAIR what has exactly one meaning. Duplicate rows whose `permission` payloads are
--      BYTE-IDENTICAL are one definition written twice; collapsing them to a single row
--      changes nobody's access. This is done automatically, below.
--
--   2. REFUSE what does not. Duplicate rows that DISAGREE about privileges have no correct
--      automatic answer: keeping one definition silently grants capabilities nobody
--      deliberately granted, keeping the other silently removes capabilities a role is
--      supposed to hold, and choosing by row order or `created_at` is arbitrary. So this
--      migration RAISES, names every offending `(workspace_id, role)` pair with the row ids
--      and a hash of each payload, and stops. The deployment does not start until an operator
--      decides which definition each role keeps.
--
--      To find them before deploying:
--        SELECT workspace_id, role, count(*), count(DISTINCT permission)
--          FROM "workspace_role" GROUP BY workspace_id, role HAVING count(*) > 1;
--      To inspect the disagreement:
--        SELECT id, permission FROM "workspace_role"
--         WHERE workspace_id = '<id>' AND role = '<name>' ORDER BY id;
--      To resolve one, delete the definition that should not survive:
--        DELETE FROM "workspace_role" WHERE id = '<id>';
--
--   3. CONSTRAIN, so the state cannot come back through a route nobody thought to guard --
--      including the native S7 role-write routes, which add the FIRST native write path to
--      this table and must not ship on top of an ambiguous one.
--
-- WHY DELETING A ROW HERE IS SAFE. Nothing in the schema references `workspace_role.id`.
-- `workspace_member.role` holds a role NAME as text, not a foreign key to this table, so no
-- membership is orphaned by removing a duplicate row. Verified by reading every
-- `references(() => workspaceRoleTable` occurrence in `apps/api/src/` -- there are none.
--
-- TIMESTAMPS ARE NOT AUTHORIZATION. The repair keeps the lexicographically smallest `id` and
-- discards the others' `created_at`/`updated_at`. Those columns are not inputs to any
-- authorization decision, and the two rows' `permission` values are identical by construction
-- -- so nothing a caller can observe about authority changes.
--
-- MIGRATION NUMBER IS PROVISIONAL. The filename is `NEXT_` rather than a number on purpose:
-- the next free number is determined by the base this actually lands on, and PR #110 already
-- holds `0050`. Rename through `pnpm db:generate` against the landed base, then update this
-- filename and the reference in `tests/api-integration/workspace-role-uniqueness.test.ts`.

DELETE FROM "workspace_role" r
USING (
  SELECT workspace_id, role, min(id) AS keep_id
  FROM "workspace_role"
  GROUP BY workspace_id, role
  HAVING count(*) > 1 AND count(DISTINCT permission) = 1
) d
WHERE r.workspace_id = d.workspace_id
  AND r.role = d.role
  AND r.id <> d.keep_id;--> statement-breakpoint

DO $$
DECLARE
  offending text;
BEGIN
  SELECT string_agg(
           format(
             '  workspace %s role %L holds %s conflicting definition(s): %s',
             workspace_id,
             role,
             cnt,
             ids
           ),
           E'\n'
         )
    INTO offending
  FROM (
    SELECT workspace_id,
           role,
           count(*) AS cnt,
           string_agg(
             format('%s [%s]', id, left(md5(permission), 12)),
             ', ' ORDER BY id
           ) AS ids
    FROM "workspace_role"
    GROUP BY workspace_id, role
    HAVING count(DISTINCT permission) > 1
  ) s;

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION E'Issue #118: % (workspace_id, role) pair(s) carry more than one permission definition, and this migration will not choose between them.\n%\nDecide which definition each role keeps, delete the rows that should not survive, then re-run the migration. See the recovery queries at the top of this file.',
      (SELECT count(*) FROM (
         SELECT 1
         FROM "workspace_role"
         GROUP BY workspace_id, role
         HAVING count(DISTINCT permission) > 1
       ) t),
      offending;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "workspace_role"
  ADD CONSTRAINT "workspace_role_workspace_id_role_unique"
  UNIQUE ("workspace_id", "role");
