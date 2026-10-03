import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import { isBootstrapMfaPending } from "./bootstrap-mfa";
import {
  isLocalFactorRequired,
  type LocalFactorPolicy,
  parseLocalFactorPolicy,
} from "./local-factor-policy";

export type LocalFactorState = {
  policy: LocalFactorPolicy;
  required: boolean;
  bootstrapRequired: boolean;
  enabled: boolean;
  personId: string;
  personSide: "staff" | "customer";
};

export async function loadLocalFactorState(
  userId: string,
): Promise<LocalFactorState> {
  const [setting] = await db
    .select({ policy: schema.instanceSettingTable.localFactorPolicy })
    .from(schema.instanceSettingTable)
    .where(eq(schema.instanceSettingTable.id, "singleton"))
    .limit(1);
  if (!setting) throw new Error("Instance factor policy is unavailable");
  const policy = parseLocalFactorPolicy(setting.policy);

  const [person] = await db
    .select({
      id: schema.personTable.id,
      side: schema.personTable.side,
      active: schema.personTable.active,
      enabled: schema.userTable.twoFactorEnabled,
    })
    .from(schema.personTable)
    .innerJoin(
      schema.userTable,
      eq(schema.personTable.userId, schema.userTable.id),
    )
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!person || (person.side !== "staff" && person.side !== "customer")) {
    throw new Error(
      "Active identity is unavailable for factor policy evaluation",
    );
  }

  const memberships = await db
    .select({ roleId: schema.membershipTable.roleId })
    .from(schema.membershipTable)
    .innerJoin(
      schema.roleTable,
      eq(schema.membershipTable.roleId, schema.roleTable.id),
    )
    .where(eq(schema.membershipTable.personId, person.id));
  if (policy.mode === "required_role") {
    const requiredRoleId = policy.requiredRoleId;
    if (!requiredRoleId)
      throw new Error("Configured factor role is unavailable");
    const configuredRole = await db
      .select({ id: schema.roleTable.id })
      .from(schema.roleTable)
      .where(eq(schema.roleTable.id, requiredRoleId))
      .limit(1);
    if (configuredRole.length !== 1) {
      throw new Error("Configured factor role is unavailable");
    }
  }

  const bootstrapRequired = await isBootstrapMfaPending(userId);
  return {
    policy,
    required:
      bootstrapRequired ||
      isLocalFactorRequired({
        policy,
        personSide: person.side,
        activeRoleIds: memberships.map(({ roleId }) => roleId),
      }),
    bootstrapRequired,
    enabled: person.enabled === true,
    personId: person.id,
    personSide: person.side,
  };
}
