import { and, eq } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every `workspace_member.role` value for one `(workspaceId, userId)` pair, and
 * whether that answer is UNAMBIGUOUS.
 *
 * THE INVARIANT THIS DEFENDS. `workspace_member` (`workspaceUserTable`,
 * `apps/api/src/database/schema.ts`) carries NO UNIQUE constraint on
 * `(workspace_id, user_id)` -- only two plain, non-unique indexes -- so more
 * than one row for the same pair is a state the database permits, and it is
 * reachable: better-auth's `acceptInvitation` (`crud-invites.mjs`, the
 * `adapter.createMember(...)` call) has no existing-member check and takes no
 * lock. Issue #88 tracks the durable fix, a `UNIQUE (workspace_id, user_id)`
 * constraint, which needs a duplicate-data audit and its own migration first.
 *
 * WHY THIS EXISTS RATHER THAN `.limit(1)`. A `LIMIT 1` read with no `ORDER BY`
 * returns whichever row the query plan's scan order produces -- an
 * implementation detail, not a contract -- and an ordinary `UPDATE` elsewhere
 * can reverse it. Three independent reviewers of pull requests #80 and #77
 * converged on the same finding from opposite sides: the RBAC evaluator's own
 * membership lookup, the exact function #80 edits to close #66, could select
 * either row and therefore grant or deny NONDETERMINISTICALLY. Measured:
 * owner-row-first returned 200 and viewer-row-first returned 403, stable over
 * twelve runs.
 *
 * The reduction is FAIL-CLOSED: an ambiguous membership is refused rather than
 * resolved by guessing. Refusing to answer when the authorization state is
 * corrupt is the only safe reading, and #88 makes the case unreachable.
 *
 * NOTE FOR THE #77 BASE UPDATE. This file is deliberately the SAME path and the
 * SAME function signatures as pull request #77's own
 * `workspace-member-roles.ts`, whose version is a strict superset (it also
 * carries `anyRoleIsOwner` and `distinctOwnerUserCount`). When #77 updates onto
 * a `main` containing this commit, git will report an add/add conflict here and
 * the correct resolution is simply to KEEP #77's superset -- these two
 * functions are byte-identical between the branches, on purpose.
 */
export async function workspaceMemberRoles(
  executor: DbOrTx,
  workspaceId: string,
  userId: string,
): Promise<string[]> {
  const rows = await executor
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.userId, userId),
      ),
    );
  return rows.map((row) => row.role);
}

/**
 * Is this pair's role answer UNAMBIGUOUS -- exactly one row?
 *
 * The single predicate every authority decision in this branch uses, so two
 * call sites cannot reduce the same rows differently. Cardinality, deliberately
 * NOT agreement: `["owner", "owner"]` is refused too, because a duplicated
 * membership row is a corrupt authorization state whatever it says. #77's
 * reviewer showed what happens when two reductions disagree on exactly that
 * shape -- one granted, the other refused, and the only owner was locked out of
 * their own transfer route with nobody else holding the capability.
 *
 * (An earlier version of this file carried #77's JSDoc for `anyRoleIsOwner`
 * here without the function, so it sat above this one describing the OPPOSITE
 * rule and naming three controllers that do not exist on this branch. Caught by
 * the independent Opus delta review of #80. #77's copy of this file keeps both
 * functions and both comments correctly.)
 */

export function isUnambiguousMembership(roles: string[]): boolean {
  return roles.length === 1;
}
