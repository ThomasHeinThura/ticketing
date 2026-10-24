import { BUILT_IN_ROLES, expandCapabilities } from "@taskdesk/permissions";
import type { Executor } from "../database/executor";
import {
  expandedRoleCapabilities,
  findWorkspaceRoleByKey,
} from "../permissions/workspace-role-authority.repository";
import { resolveMembershipRole } from "../utils/workspace-member-roles";
import {
  InsufficientPermissionToGrantError,
  RoleRankError,
} from "./controllers/workspace-role-errors";

/**
 * Handing a person a role (add, change, invite) may never raise anyone above the person doing
 * it. `manager` and `lead` are real roles now, and both can manage members, so without this a
 * manager could promote themselves to `admin`. The rule is the single-assignment counterpart of
 * the bulk-reassignment rank guard (`role-service.ts`):
 *
 *  - the role being given must not outrank the actor (equal rank is allowed here, as it always
 *    was for admins adding admins; bulk reassignment is stricter because it rewrites peers);
 *  - the person's current role, when they have one, must not outrank the actor either;
 *  - rank alone is not authority (RL-3): a custom role may carry any capability at any rank (an
 *    Admin clone defaults to rank 30), so the capabilities of the role being given must all be
 *    held by the actor. This also stops anyone raising their own role: a self change is refused
 *    unless the new role holds nothing the actor's current role does not.
 *
 * `owner` is compiled at rank 100; an actor with no resolvable role holds no rank and is refused.
 */
export async function assertMayAssignRole(
  executor: Executor,
  input: {
    workspaceId: string;
    actorUserId: string;
    targetRoleKey: string;
    currentRoleKey?: string;
  },
): Promise<void> {
  const membership = await resolveMembershipRole(
    executor,
    input.workspaceId,
    input.actorUserId,
  );
  if (!membership.ok) {
    throw new RoleRankError("You cannot assign roles in this workspace");
  }
  const rankOf = async (key: string): Promise<number> => {
    if (key === "owner") return BUILT_IN_ROLES.owner.rank;
    const row = await findWorkspaceRoleByKey(executor, input.workspaceId, key);
    // An unknown role is refused earlier by the caller; fail closed to the highest rank.
    return row ? row.rank : Number.POSITIVE_INFINITY;
  };
  const actorRank = await rankOf(membership.role);
  if ((await rankOf(input.targetRoleKey)) > actorRank) {
    throw new RoleRankError(
      "You cannot give someone a role ranked above your own",
    );
  }
  const heldByActor =
    membership.role === "owner"
      ? expandCapabilities(BUILT_IN_ROLES.owner.capabilities, {
          tier: "workspace",
        })
      : await capabilitiesOf(executor, input.workspaceId, membership.role);
  const wanted = await capabilitiesOf(
    executor,
    input.workspaceId,
    input.targetRoleKey,
  );
  const missing =
    wanted === null || heldByActor === null
      ? ["unknown"]
      : [...wanted].filter((name) => !heldByActor.has(name));
  if (missing.length > 0) throw new InsufficientPermissionToGrantError(missing);
  if (
    input.currentRoleKey !== undefined &&
    (await rankOf(input.currentRoleKey)) > actorRank
  ) {
    throw new RoleRankError(
      "You cannot change the role of someone ranked above you",
    );
  }
}

/** The expanded capability closure of a role row, or `null` when it does not resolve. */
async function capabilitiesOf(
  executor: Executor,
  workspaceId: string,
  key: string,
): Promise<ReadonlySet<string> | null> {
  if (key === "owner")
    return expandCapabilities(BUILT_IN_ROLES.owner.capabilities, {
      tier: "workspace",
    });
  const row = await findWorkspaceRoleByKey(executor, workspaceId, key);
  return row ? expandedRoleCapabilities(row.capabilities) : null;
}
