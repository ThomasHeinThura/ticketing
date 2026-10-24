import { eq } from "drizzle-orm";
import db, { schema } from "../../database";

export type ImpersonationRefusal = {
  status: 403 | 404 | 409;
  message: string;
};

/**
 * `GM-10` plus the most restrictive reading of the contract's silence on other targets:
 * the target must exist, must not be the actor, must not be an instance administrator, must not
 * be suspended, and must be exactly one active staff person. A customer-portal identity is never
 * impersonable here because an impersonation session is minted by the agent auth instance and
 * would carry `portal = agent` (agent/portal separation).
 */
export async function checkImpersonationTarget(
  actorUserId: string,
  targetUserId: string,
): Promise<ImpersonationRefusal | null> {
  const [target] = await db
    .select({
      id: schema.userTable.id,
      role: schema.userTable.role,
      banned: schema.userTable.banned,
      anonymous: schema.userTable.isAnonymous,
    })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, targetUserId))
    .limit(1);
  if (!target) return { status: 404, message: "User not found" };
  if (target.id === actorUserId)
    return { status: 409, message: "self_target_refused" };
  if ((target.role ?? "").split(",").some((role) => role.trim() === "admin"))
    return {
      status: 403,
      message:
        "impersonation: an instance administrator cannot be impersonated",
    };
  if (target.banned || target.anonymous)
    return { status: 409, message: "impersonation_target_not_eligible" };
  const people = await db
    .select({
      side: schema.personTable.side,
      active: schema.personTable.active,
    })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, targetUserId));
  if (people.length !== 1 || people[0]?.side !== "staff" || !people[0]?.active)
    return { status: 409, message: "impersonation_target_not_eligible" };
  return null;
}
