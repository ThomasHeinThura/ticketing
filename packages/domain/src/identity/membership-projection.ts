export type MembershipGrantCandidate = {
  id: string;
  sourceKind: "direct" | "jit_default" | "oidc_group" | "scim_group";
  roleId: string;
  roleRank: number;
  seesAll: boolean;
};

export type EffectiveMembershipProjection =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "conflict"; reason: "multiple_direct" | "equal_rank_roles" }
  | {
      kind: "projected";
      roleId: string;
      seesAll: boolean;
      sourceKind: MembershipGrantCandidate["sourceKind"];
      grantId: string;
    };

const externalSourcePriority = {
  jit_default: 1,
  oidc_group: 2,
  scim_group: 3,
} as const;

export function projectEffectiveMembership(
  grants: readonly MembershipGrantCandidate[],
): EffectiveMembershipProjection {
  const ids = new Set<string>();
  for (const grant of grants) {
    if (
      typeof grant.id !== "string" ||
      grant.id.length === 0 ||
      ids.has(grant.id) ||
      typeof grant.roleId !== "string" ||
      grant.roleId.length === 0 ||
      !Number.isSafeInteger(grant.roleRank) ||
      grant.roleRank < 0 ||
      typeof grant.seesAll !== "boolean" ||
      (grant.sourceKind !== "direct" && grant.seesAll)
    ) {
      return { kind: "invalid" };
    }
    ids.add(grant.id);
  }

  const direct = grants.filter((grant) => grant.sourceKind === "direct");
  if (direct.length > 1) return { kind: "conflict", reason: "multiple_direct" };
  const selectedDirect = direct[0];
  if (selectedDirect) {
    return {
      kind: "projected",
      roleId: selectedDirect.roleId,
      seesAll: selectedDirect.seesAll,
      sourceKind: selectedDirect.sourceKind,
      grantId: selectedDirect.id,
    };
  }

  if (grants.length === 0) return { kind: "none" };
  const highestRank = Math.max(...grants.map((grant) => grant.roleRank));
  const leaders = grants.filter((grant) => grant.roleRank === highestRank);
  const roleIds = new Set(leaders.map((grant) => grant.roleId));
  if (roleIds.size > 1) return { kind: "conflict", reason: "equal_rank_roles" };

  const selected = [...leaders].sort((left, right) => {
    const leftPriority =
      left.sourceKind === "direct"
        ? 0
        : externalSourcePriority[left.sourceKind];
    const rightPriority =
      right.sourceKind === "direct"
        ? 0
        : externalSourcePriority[right.sourceKind];
    return rightPriority - leftPriority || left.id.localeCompare(right.id);
  })[0];
  if (!selected) return { kind: "none" };
  return {
    kind: "projected",
    roleId: selected.roleId,
    seesAll: false,
    sourceKind: selected.sourceKind,
    grantId: selected.id,
  };
}
