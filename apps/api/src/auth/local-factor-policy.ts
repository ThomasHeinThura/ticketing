export const LOCAL_FACTOR_POLICY_MODES = [
  "off",
  "optional",
  "required_staff",
  "required_role",
  "required_everyone",
] as const;

export type LocalFactorPolicyMode = (typeof LOCAL_FACTOR_POLICY_MODES)[number];

export type LocalFactorPolicy = {
  mode: LocalFactorPolicyMode;
  requiredRoleId: string | null;
};

export function parseLocalFactorPolicy(value: unknown): LocalFactorPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid local factor policy");
  }
  const entries = Object.entries(value);
  if (
    entries.length !== 2 ||
    !Object.hasOwn(value, "mode") ||
    !Object.hasOwn(value, "requiredRoleId")
  ) {
    throw new Error("Invalid local factor policy");
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.mode !== "string" ||
    !LOCAL_FACTOR_POLICY_MODES.includes(candidate.mode as LocalFactorPolicyMode)
  ) {
    throw new Error("Invalid local factor policy");
  }
  const mode = candidate.mode as LocalFactorPolicyMode;
  const requiredRoleId = candidate.requiredRoleId;
  if (
    (mode === "required_role" &&
      (typeof requiredRoleId !== "string" || requiredRoleId.length === 0)) ||
    (mode !== "required_role" && requiredRoleId !== null)
  ) {
    throw new Error("Invalid local factor policy");
  }

  return { mode, requiredRoleId: requiredRoleId as string | null };
}

export function isLocalFactorRequired(input: {
  policy: LocalFactorPolicy;
  personSide: "staff" | "customer";
  activeRoleIds: readonly string[];
}): boolean {
  const { mode, requiredRoleId } = input.policy;
  switch (mode) {
    case "off":
    case "optional":
      return false;
    case "required_staff":
      return input.personSide === "staff";
    case "required_role":
      return (
        requiredRoleId !== null && input.activeRoleIds.includes(requiredRoleId)
      );
    case "required_everyone":
      return true;
  }
}
