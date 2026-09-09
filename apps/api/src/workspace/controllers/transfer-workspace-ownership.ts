import { and, eq, sql } from "drizzle-orm";
import db, { schema } from "../../database";
import {
  AlreadyOwnerError,
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
 * at all -- unlike every other S4/S5 mutation route. Ownership is never a
 * `workspace_role` row (retrofit plan R5: `owner` is deliberately never
 * seeded one), so there is no capability to check it against, and
 * `hasWorkspacePermission`'s instance-admin bypass is therefore structurally
 * unreachable here: this function reads the caller's OWN
 * `workspace_member.role` fresh from the database and requires it to
 * literally equal `"owner"`. An instance admin who is not this workspace's
 * owner fails that read exactly like anyone else -- there is no bypass
 * branch that could apply, because none of this function's checks go
 * through `isInstanceAdmin` in the first place.
 *
 * Both the "am I the owner" read and the "is the new owner a member" read,
 * and both writes, run inside `lockWorkspaceMembership`'s advisory lock, so
 * two concurrent transfers from the same owner (to two different targets)
 * cannot both succeed: whichever commits first demotes the caller, and the
 * second transaction's own re-read of the caller's role -- taken AFTER it
 * acquires the lock the first transaction just released -- finds `"admin"`,
 * not `"owner"`, and refuses. See `workspace-membership-writes-negative.
 * test.ts` for the concurrent probe.
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

    const [caller] = await tx
      .select({ role: schema.workspaceUserTable.role })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, callerId),
        ),
      )
      .limit(1);
    if (caller?.role !== "owner") {
      throw new CallerNotOwnerError();
    }

    const [newOwner] = await tx
      .select({ userId: schema.workspaceUserTable.userId })
      .from(schema.workspaceUserTable)
      .where(
        and(
          eq(schema.workspaceUserTable.workspaceId, workspaceId),
          eq(schema.workspaceUserTable.userId, newOwnerUserId),
        ),
      )
      .limit(1);
    if (!newOwner) {
      throw new NewOwnerNotAMemberError();
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
