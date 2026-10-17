import db from "../database";
import {
  isLocalFactorRequired,
  type LocalFactorPolicy,
  parseLocalFactorPolicy,
} from "./local-factor-policy";
import {
  getActiveLocalFactorIdentity,
  getConfiguredLocalFactorRole,
  getInactiveLocalFactorIdentity,
  getLocalFactorMembershipRoles,
  getLocalFactorPolicySetting,
  type StepUpExecutor,
} from "./repository";

export type LocalFactorState = {
  policy: LocalFactorPolicy;
  required: boolean;
  enabled: boolean;
  personId: string;
  personSide: "staff" | "customer";
};

export class InactiveFactorIdentityError extends Error {
  constructor() {
    super("Identity is inactive for factor policy evaluation");
    this.name = "InactiveFactorIdentityError";
  }
}

export async function loadLocalFactorState(
  userId: string,
  executor: typeof db | StepUpExecutor = db,
): Promise<LocalFactorState> {
  const [person] = await getActiveLocalFactorIdentity(userId, executor);
  if (!person || (person.side !== "staff" && person.side !== "customer")) {
    const [inactivePerson] = await getInactiveLocalFactorIdentity(
      userId,
      executor,
    );
    if (inactivePerson) throw new InactiveFactorIdentityError();
    throw new Error(
      "Active identity is unavailable for factor policy evaluation",
    );
  }

  // Resolve the person first so an inactive identity is denied as such even when the
  // instance setting row is missing or the stored policy does not parse.
  const [setting] = await getLocalFactorPolicySetting(executor);
  if (!setting) throw new Error("Instance factor policy is unavailable");
  const policy = parseLocalFactorPolicy(setting.policy);

  const memberships = await getLocalFactorMembershipRoles(person.id, executor);
  if (policy.mode === "required_role") {
    const requiredRoleId = policy.requiredRoleId;
    if (!requiredRoleId)
      throw new Error("Configured factor role is unavailable");
    const configuredRole = await getConfiguredLocalFactorRole(
      requiredRoleId,
      executor,
    );
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
