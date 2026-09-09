import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import { builtInRoleHasCapability } from "../../utils/require-workspace-capability";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "../../utils/workspace-member-roles";
import {
  AlreadyOwnerError,
  AmbiguousMembershipError,
  CallerNotOwnerError,
  NewOwnerNotAMemberError,
} from "./workspace-membership-errors";
import { WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE } from "./workspace-membership-lock";

/** What every demoted owner becomes -- matches the role the client's own
 * promote/demote pair demoted the previous owner to
 * (`apps/web/src/hooks/mutations/workspace/use-transfer-workspace-ownership.ts:41`). */
const PREVIOUS_OWNER_FALLBACK_ROLE = "admin";

export type TransferredWorkspaceOwnership = {
  workspaceId: string;
  previousOwnerUserId: string;
  previousOwnerNewRole: string;
  newOwnerUserId: string;
};

/**
 * THE ATOMIC REPLACEMENT for the client's promote/demote pair.
 *
 * Retrofit plan S5 row: "the client fakes [the last-owner rule] with a
 * promote/demote pair (`use-transfer-workspace-ownership.ts:29,38`), which
 * should collapse into one atomic transfer endpoint." That hook's own
 * comment names the exact hazard this closes: "if step 2 fails, the
 * workspace ends up with two owners" -- two sequential HTTP calls, so a
 * crash, a network failure or a concurrent request between them leaves that
 * window open for as long as nobody notices. Here both role changes commit
 * in ONE transaction: either the new owner is installed AND the old owner
 * demoted, or neither happens.
 *
 * NOT gated by `requireWorkspacePermission`/`requireWorkspaceRoleAuthority`
 * at all -- unlike every other S4/S5 mutation route, because those read the
 * INHERITED better-auth-shaped statements, which have no concept of
 * `workspace:transfer_ownership` (or of `owner` as a distinct grantable
 * entry: retrofit plan R5, `owner` is deliberately never seeded a
 * `workspace_role` row). The route's own middleware,
 * `requireWorkspaceCapability("workspace:transfer_ownership")`
 * (`apps/api/src/utils/require-workspace-capability.ts`), is the PRIMARY
 * authority gate and runs before this function at all -- it evaluates the
 * SAME capability the route policy declares, against the caller's own
 * freshly-read role, using the canonical `@taskdesk/permissions` capability
 * data rather than the inherited statements. It never calls
 * `isInstanceAdmin` either, so an instance admin who is not this workspace's
 * owner is refused there already, before this function ever runs.
 *
 * This function's OWN check below -- `caller.role` must still resolve to
 * `workspace:transfer_ownership` at the moment the lock is held -- is
 * RETAINED as a race-safety / invariant check, not as the only authority
 * check on this path anymore. Both call the identical
 * `builtInRoleHasCapability`, so the pre-check and this re-check can never
 * independently disagree about who holds the capability.
 *
 * Both the "am I the owner" read and the "is the new owner a member" read,
 * and both writes, run inside `lockWorkspaceMembership`'s advisory lock, so
 * two concurrent transfers from the same owner (to two different targets)
 * cannot both succeed: whichever commits first demotes the caller, and the
 * second transaction's own re-read of the caller's role -- taken AFTER it
 * acquires the lock the first transaction just released -- finds `"admin"`,
 * which does not hold `workspace:transfer_ownership`, and refuses. See
 * `workspace-membership-writes-negative.test.ts` for the concurrent probe.
 */
async function transferWorkspaceOwnership(
  workspaceId: string,
  callerId: string,
  newOwnerUserId: string,
): Promise<TransferredWorkspaceOwnership> {
  if (newOwnerUserId === callerId) {
    throw new AlreadyOwnerError();
  }

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE}, hashtext(${workspaceId}))`,
    );

    // An unambiguous answer is required here: the caller's authority must
    // never be inferred from an arbitrary row when the pair has more than
    // one (`workspace_member` carries no unique constraint on
    // `(workspace_id, user_id)` -- see `workspaceMemberRoles`'s doc comment).
    // More than one row for the caller is refused through this route's
    // existing forbidden path rather than picking one to trust.
    const callerRoles = await workspaceMemberRoles(tx, workspaceId, callerId);
    if (
      !isUnambiguousMembership(callerRoles) ||
      !builtInRoleHasCapability(callerRoles[0], "workspace:transfer_ownership")
    ) {
      throw new CallerNotOwnerError();
    }

    // The INCOMING owner's membership must be unambiguous too, symmetric with
    // the caller check above. This used to be a bare existence read, and the
    // `UPDATE` below matches `(workspaceId, userId)` -- so transferring to a
    // member who held two rows set BOTH to `"owner"`, manufacturing exactly
    // the two-owner-rows-for-one-user state the last-owner guards then
    // misread. Found by the independent security review of this pull request,
    // which walked the whole chain to a zero-owner workspace with no
    // unauthorized step in it. Refusing here removes the manufacturing step;
    // `distinctOwnerUserCount` removes the misreading step.
    const newOwnerRoles = await workspaceMemberRoles(
      tx,
      workspaceId,
      newOwnerUserId,
    );
    if (newOwnerRoles.length === 0) {
      throw new NewOwnerNotAMemberError();
    }
    if (!isUnambiguousMembership(newOwnerRoles)) {
      throw new AmbiguousMembershipError();
    }

    await tx
      .update(schema.workspaceUserTable)
      .set({ role: "owner" })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, newOwnerUserId),
        ),
      );

    await tx
      .update(schema.workspaceUserTable)
      .set({ role: PREVIOUS_OWNER_FALLBACK_ROLE })
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, callerId),
        ),
      );

    return {
      workspaceId,
      previousOwnerUserId: callerId,
      previousOwnerNewRole: PREVIOUS_OWNER_FALLBACK_ROLE,
      newOwnerUserId,
    };
  });
}

export default transferWorkspaceOwnership;
