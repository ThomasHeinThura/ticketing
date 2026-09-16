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
--   1. REPAIR what can be repaired without deciding anyone's privileges. CORRECTED after an
--      independent formal review (R1) found the original version of this rule manufactured
--      authority instead of preserving it. The original rule collapsed a value to its one
--      DISTINCT TRIMMED piece -- so " owner" (one piece, no comma at all, merely padded)
--      collapsed to "owner" the same way "admin,admin" collapses to "admin". Those are not
--      the same case:
--
--        - "admin,admin" already contains a CLEAN "admin" piece, byte-identical, no comma
--          needed. better-auth's own comma-split-and-OR evaluator (no `.trim()` anywhere in
--          it) already reads this row as granting `admin` TODAY. Collapsing to "admin"
--          changes nothing either evaluator was already doing.
--        - " owner" has no comma and one piece, and that piece is itself padded. Traced
--          against the real better-auth evaluator: `" owner".split(",")` = `[" owner"]`, and
--          neither `.includes("owner")` (the creator check) nor an `acRoles[" owner"]`
--          lookup matches the padded string -- so TODAY this row grants NOTHING. Trimming it
--          to "owner" does not restate an existing agreement; it MANUFACTURES one, and
--          because "owner" is the one role whose authority is compiled-in and unbounded
--          (`require-workspace-permission.ts`), the manufactured agreement is full, ungated
--          workspace ownership, minted silently by this very migration.
--
--      So the corrected rule requires TWO things, not one: every non-empty RAW (untrimmed)
--      comma-separated piece must already be the exact same byte string, AND that string
--      must already be well-formed on its own (no padding of its own). No comma at all is
--      NEVER auto-repaired -- there is no second piece to confirm agreement against, so
--      trimming a lone padded piece would be inventing agreement rather than finding it.
--      This is done automatically, below.
--
--         "admin,admin"  -> "admin"   (both raw pieces already clean and identical)
--         "admin,"       -> "admin"   (the one non-empty raw piece already clean)
--         ",admin"       -> "admin"   (same)
--         "admin,,admin" -> "admin"   (same, extra empty piece dropped)
--         " owner"       -> REFUSED   (no comma; nothing to confirm agreement against)
--         "admin, admin" -> REFUSED   (raw pieces "admin" and " admin" are NOT identical)
--
--   2. REFUSE what cannot. A value naming two DIFFERENT roles -- "owner,admin" -- has no
--      correct automatic answer: keeping the higher role grants privileges nobody
--      deliberately granted, keeping the lower one silently demotes a member, and picking by
--      position is arbitrary. The same REFUSE branch now also catches every case the
--      corrected repair rule above declines to touch (any padded value with no comma; any
--      comma-bearing value whose raw pieces are not byte-identical) -- exactly the residual
--      widening this correction requires, because a value the repair rule does not touch
--      still fails the CHECK constraint at step 3 and must stop the deployment the same way
--      a genuine two-role conflict does. So this migration RAISES, names every offending
--      row, and stops. The deployment does not start until an operator assigns each of those
--      members a single role. That is a deliberate hard stop, and it is safe to make one:
--      the application already fails closed on these rows at read time (both
--      `require-workspace-permission.ts` and `/api/capabilities` refuse them), so the
--      pressure to guess quickly is off. The alternative -- guessing, or trimming toward an
--      answer -- is how a privilege escalation becomes permanent and invisible.
--
--      To find them before deploying:
--        SELECT id, workspace_id, user_id, role FROM workspace_member
--         WHERE position(',' in role) > 0
--            OR role <> btrim(role, E' \t\n\r\f' || chr(11) || ...)
--            OR btrim(role, E' \t\n\r\f' || chr(11) || ...) = '';
--      To resolve one, assign the single role that member should have:
--        UPDATE workspace_member SET role = 'admin' WHERE id = '<id>';
--
--   3. CONSTRAIN, so the state cannot come back through a route nobody thought to guard --
--      including the native S7 role-write routes that land after this.
--
-- THE WHITESPACE CLASS, STATED EXPLICITLY BECAUSE IT ONCE DRIFTED SILENTLY. PostgreSQL's
-- one-argument `btrim(x)` strips only the literal space character (0x20). JS
-- `String.prototype.trim()` -- what `membershipRoleProblem()` and `repairableMembershipRole()`
-- in `packages/permissions/src/membership-role-value.ts` actually run -- strips the full
-- ECMAScript WhiteSpace/LineTerminator set: tab, newline, carriage return, form feed,
-- vertical tab, NBSP, and several other Unicode space separators. A one-argument `btrim`
-- CHECK measurably let `"\t"`, `"\n"`, `"\tadmin"` and `"admin\n"` all through as
-- well-formed, while the TypeScript layer calls every one of them either empty or
-- untrimmed -- a real gap in a backstop whose stated job is to guard routes nobody
-- remembered to check.
--
-- Every `btrim` below therefore takes an explicit two-argument character list covering the
-- complete ECMAScript `trim()` set. `chr()` keeps invisible characters reviewable; PostgreSQL
-- does not define `\v` in escape strings, so vertical tab is explicitly `chr(11)`.
--
-- So: the repair rule here and `repairableMembershipRole()` are the same rule in two
-- languages; `membership-role-value.test.ts` and the migration integration tests pin that.

-- CORRECTED repair predicate (see the header note above): only comma-bearing values are
-- eligible at all (`position(',' in wm."role") > 0` in the inner WHERE), every non-empty
-- RAW piece must already be byte-identical (`count(DISTINCT s.piece) = 1`, computed over
-- the UNTRIMMED piece, never `btrim(piece, ...)`), and that one surviving piece must
-- already be well-formed on its own (`min(s.piece) = btrim(min(s.piece), ...)`). A value
-- with no comma at all never enters this UPDATE's source set and falls through to the
-- REFUSE check below, unrepaired.
UPDATE "workspace_member" AS m
SET "role" = r.only_role
FROM (
  SELECT s.id, min(s.piece) AS only_role
  FROM (
    SELECT wm.id, piece
    FROM "workspace_member" wm,
         unnest(string_to_array(wm."role", ',')) AS piece
    WHERE position(',' in wm."role") > 0
      AND piece <> ''
  ) s
  GROUP BY s.id
  HAVING count(DISTINCT s.piece) = 1
     AND min(s.piece) = btrim(min(s.piece), E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))
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
    OR "role" <> btrim("role", E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))
    OR btrim("role", E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) = '';

  IF offending IS NOT NULL THEN
    RAISE EXCEPTION E'Issue #82: % membership row(s) hold more than one role, and this migration will not choose which one to keep.\n%\nAssign each of these members exactly one role, then re-run the migration. See apps/api/drizzle/0050_enforce_single_role_membership.sql for the queries.',
      (SELECT count(*) FROM "workspace_member"
        WHERE position(',' in "role") > 0
           OR "role" <> btrim("role", E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))
           OR btrim("role", E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) = ''),
      offending;
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "workspace_member"
  ADD CONSTRAINT "workspace_member_role_single_value"
  CHECK (
    position(',' in "role") = 0
    AND "role" = btrim("role", E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279))
    AND btrim("role", E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)) <> ''
  );
