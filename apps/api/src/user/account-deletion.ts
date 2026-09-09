export type WorkspaceMembershipSummary = {
  workspaceId: string;
  workspaceName: string;
  isOwner: boolean;
  memberCount: number;
  ownerCount: number;
};

export type AccountDeletionPlan = {
  blockedWorkspaceNames: string[];
  workspaceIdsToDelete: string[];
  workspaceIdsToLeave: string[];
};

/**
 * Does this stored role value grant owner, reading a comma-joined value
 * INCLUSIVELY?
 *
 * Used for the `isOwner` half of the account-deletion plan, where the inclusive
 * reading is the safe one: `planAccountDeletion` blocks on
 * `isOwner && ownerCount <= 1`, so a false `isOwner` skips the block.
 *
 * **Do NOT use it to COUNT owners** -- see `holdsOwnerExactly` below.
 */
export function hasOwnerRole(role: string) {
  return role
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .includes("owner");
}

/**
 * Does this stored role value grant owner UNAMBIGUOUSLY -- exactly `"owner"`?
 *
 * THE ASYMMETRY, AND WHY IT IS NOT A TYPO. `planAccountDeletion`'s guard is
 *
 *     if (isOwner && ownerCount <= 1) -> block the deletion
 *
 * so the two inputs want OPPOSITE readings of a corrupt role value:
 *
 *   - `isOwner` wants the INCLUSIVE reading (`hasOwnerRole`). A false `isOwner`
 *     skips the block entirely.
 *   - `ownerCount` wants the EXACT reading. **Over**-counting owners makes
 *     `ownerCount <= 1` false, which ALSO skips the block -- and then the sole
 *     owner deletes their account and the workspace is orphaned.
 *
 * Counting with `hasOwnerRole` did exactly that: a second member holding a role
 * merely *named* `"owner,x"` -- and `create-role` only lowercases names, so one
 * is creatable -- counted as a second owner, and the genuine sole owner's
 * deletion stopped being blocked. Measured by the independent Opus review of
 * pull request #77: `realOwnersAfter = []`.
 *
 * An earlier write-up of this reasoning (on issue #82) had the direction
 * INVERTED, claiming over-counting was the safe side because it would refuse a
 * deletion. It does not refuse; it permits. Recorded here because the wrong
 * version was stated confidently and could be believed again.
 *
 * Issue #82 removes the comma-joined value at its source and a `CHECK`
 * constraint makes it unreachable, at which point both readings converge and
 * this function can be deleted.
 */
export function holdsOwnerExactly(role: string) {
  return role.trim().toLowerCase() === "owner";
}

export function planAccountDeletion(
  memberships: WorkspaceMembershipSummary[],
): AccountDeletionPlan {
  const plan: AccountDeletionPlan = {
    blockedWorkspaceNames: [],
    workspaceIdsToDelete: [],
    workspaceIdsToLeave: [],
  };

  for (const membership of memberships) {
    if (membership.memberCount <= 1) {
      plan.workspaceIdsToDelete.push(membership.workspaceId);
      continue;
    }

    if (membership.isOwner && membership.ownerCount <= 1) {
      plan.blockedWorkspaceNames.push(membership.workspaceName);
      continue;
    }

    plan.workspaceIdsToLeave.push(membership.workspaceId);
  }

  return plan;
}

export function formatBlockedWorkspacesMessage(names: string[]) {
  const quoted = names.map((name) => `"${name}"`);
  const list =
    quoted.length === 1
      ? quoted[0]
      : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;

  return `You are the only owner of ${list}. Transfer ownership or delete ${names.length === 1 ? "it" : "them"} before deleting your account.`;
}
