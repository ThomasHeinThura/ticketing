import { eq } from "drizzle-orm";
import db, { schema } from "../../database";
import { isCurrentInstanceAdmin } from "../observability/audit-failure-notifier";

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

/**
 * P4R1-M3: an impersonation session lives only as long as the administrator running it is still
 * an instance administrator who is not suspended. Checked on every request of the session and
 * fail closed: a missing user, an unreadable row or a lapsed role all end the session.
 */
export async function impersonatorStillEligible(
  impersonatorUserId: string,
): Promise<boolean> {
  try {
    // The one definition of "instance administrator" (admin role, one active staff person) ...
    if (!(await isCurrentInstanceAdmin(impersonatorUserId))) return false;
    // ... and not suspended (a finite ban that has lapsed no longer counts).
    const [admin] = await db
      .select({
        banned: schema.userTable.banned,
        banExpires: schema.userTable.banExpires,
      })
      .from(schema.userTable)
      .where(eq(schema.userTable.id, impersonatorUserId))
      .limit(1);
    if (!admin) return false;
    if (admin.banned !== true) return true;
    return (
      admin.banExpires instanceof Date &&
      admin.banExpires.getTime() <= Date.now()
    );
  } catch {
    return false;
  }
}
