import { and, countDistinct, eq } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Every `workspace_member.role` value for one `(workspaceId, userId)` pair.
 *
 * THE INVARIANT THIS DEFENDS. `workspace_member` (`workspaceUserTable`,
 * `apps/api/src/database/schema.ts`) carries NO UNIQUE constraint on
 * `(workspace_id, user_id)` -- only two plain, non-unique indexes
 * (`workspace_member_workspaceId_idx`, `workspace_member_userId_idx`) -- so
 * more than one row for the same pair is a state the database permits, and
 * it is reachable today: better-auth's `acceptInvitation` (`crud-invites.mjs`,
 * the `adapter.createMember(...)` call) has no existing-member check and
 * takes no lock. Invite a user who is not yet a member (invitation goes
 * pending), add that same user through the native add route
 * (`add-workspace-member.ts`), then have them accept the still-pending
 * invitation, and the pair now has two rows. See
 * `tests/api-integration/workspace-membership-duplicate-rows.test.ts`, probe
 * P1, for the reachability proof.
 *
 * WHY THIS FUNCTION EXISTS, RATHER THAN `.limit(1)`. A `LIMIT 1` read with no
 * `ORDER BY` returns whichever row a sequential scan produces first -- heap
 * order, not insertion order or any other meaning -- and an ordinary
 * `UPDATE` elsewhere can silently reverse it: PostgreSQL MVCC writes an
 * updated row as a new tuple appended to the end of the heap, so updating
 * the row that used to come "first" moves it after the others. Six call
 * sites in this codebase used to read one arbitrary row's role and act as
 * though it were the pair's only row:
 *
 *  - `remove-workspace-member.ts` and `leave-workspace.ts` skip the
 *    last-owner guard entirely when the unordered read happens to return a
 *    duplicate member's NON-owner row, then delete every row for the pair
 *    (including the owner row) -- leaving the workspace with zero owners.
 *  - `update-workspace-member-role.ts` skips the "current role is owner"
 *    refusal the same way, then updates every row for the pair -- silently
 *    demoting an owner.
 *  - `transfer-workspace-ownership.ts` reads the caller's authority from one
 *    arbitrary row.
 *  - `require-workspace-capability.ts` decides a capability grant from one
 *    arbitrary row -- a nondeterministic authorization answer for the exact
 *    same member, call to call.
 *
 * This function returns the WHOLE set instead, so every caller reasons
 * about all of it rather than trusting one arbitrary row.
 *
 * Deliberately UNORDERED -- there is no correct order to impose on a state
 * the schema should never have permitted, and imposing one would only make
 * the arbitrary answer deterministic, not correct. The durable fix is a
 * UNIQUE constraint on `(workspace_id, user_id)`; that needs its own
 * migration and a duplicate-data audit first and is tracked separately, not
 * part of this change.
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
 * Does ANY row in `roles` (as returned by `workspaceMemberRoles`) hold role
 * `"owner"`?
 *
 * The most restrictive direction for an owner guard: a duplicate-row member
 * with roles `["viewer", "owner"]` must still be treated as an owner for the
 * last-owner guard (`remove-workspace-member.ts`, `leave-workspace.ts`) and
 * the self-demote guard (`update-workspace-member-role.ts`) -- missing the
 * `"owner"` row because an unordered read happened to return the other one
 * first is exactly the defect this file exists to close.
 */
export function anyRoleIsOwner(roles: string[]): boolean {
  return roles.includes("owner");
}

/**
 * How many DISTINCT USERS hold `role = "owner"` in this workspace.
 *
 * WHY THIS IS NOT `rows.length`, and why getting it wrong was a privilege
 * defect rather than a tidiness one. The last-owner guards in
 * `leave-workspace.ts` and `remove-workspace-member.ts` ask "would this
 * removal leave the workspace with no owner?". Before this function they
 * answered it by counting owner ROWS. With no unique constraint on
 * `(workspace_id, user_id)` a single owner user can hold two `"owner"` rows,
 * so the count returned 2, the guard concluded "there is another owner", and
 * the delete -- which matches on `(workspaceId, userId)` and therefore removes
 * EVERY row for that pair -- left the workspace with **zero owners**.
 *
 * Found by the independent security review of this pull request, which also
 * showed the route that manufactures the precondition: the ownership transfer
 * used to set `role = "owner"` on every row of the incoming owner, so
 * transferring to a duplicated member produced exactly the two-owner-rows
 * state this guard then misread. Both halves are fixed; this is the half that
 * makes the invariant hold even if some other path produces duplicates.
 *
 * Note the asymmetry with `workspaceMemberRoles`, and that it is deliberate:
 * "what is THIS user's role" must refuse to guess when the answer is
 * ambiguous, while "how many owner USERS are there" has a correct answer even
 * when rows are duplicated -- so one denies on ambiguity and the other
 * deduplicates.
 */
export async function distinctOwnerUserCount(
  executor: DbOrTx,
  workspaceId: string,
): Promise<number> {
  const [row] = await executor
    .select({ owners: countDistinct(schema.workspaceUserTable.userId) })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
        eq(schema.workspaceUserTable.role, "owner"),
      ),
    );
  return Number(row?.owners ?? 0);
}

/**
 * Is this pair's role answer UNAMBIGUOUS -- exactly one row?
 *
 * The single predicate every authority decision uses, so two call sites
 * cannot reduce the same rows differently. The review of this pull request
 * found exactly that: the capability middleware reduced with `.every(...)`
 * while the transfer controller reduced with `length !== 1`, so for
 * `["owner", "owner"]` the middleware granted and the controller refused --
 * fail-closed, but it locked the only owner out of the transfer route with no
 * other holder of the capability, making ownership unmovable without database
 * surgery.
 */
export function isUnambiguousMembership(roles: string[]): boolean {
  return roles.length === 1;
}
