import {
  isLocalFactorRequired,
  type LocalFactorPolicy,
  parseLocalFactorPolicy,
} from "./local-factor-policy";
import {
  getActivePersonFactorState,
  getLocalFactorPolicyRow,
  getRoleById,
  listPersonRoleMemberships,
} from "./repository";

export type LocalFactorState = {
  policy: LocalFactorPolicy;
  required: boolean;
  enabled: boolean;
  personId: string;
  personSide: "staff" | "customer";
};

export async function loadLocalFactorState(
  userId: string,
): Promise<LocalFactorState> {
  const [setting] = await getLocalFactorPolicyRow();
  if (!setting) throw new Error("Instance factor policy is unavailable");
  const policy = parseLocalFactorPolicy(setting.policy);

  const [person] = await getActivePersonFactorState(userId);
  if (!person || (person.side !== "staff" && person.side !== "customer")) {
    throw new Error(
      "Active identity is unavailable for factor policy evaluation",
    );
  }

  const memberships = await listPersonRoleMemberships(person.id);
  if (policy.mode === "required_role") {
    const requiredRoleId = policy.requiredRoleId;
    if (!requiredRoleId)
      throw new Error("Configured factor role is unavailable");
    const configuredRole = await getRoleById(requiredRoleId);
    if (configuredRole.length !== 1) {
      throw new Error("Configured factor role is unavailable");
    }
  }

  return {
    policy,
    required: isLocalFactorRequired({
      policy,
      personSide: person.side,
      activeRoleIds: memberships.map(({ roleId }) => roleId),
    }),
    enabled: person.enabled === true,
    personId: person.id,
    personSide: person.side,
  };
}
