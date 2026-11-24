import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../../database";
import type { Transaction } from "../../database/executor";
import {
  listAdminIds,
  lockGrantTarget,
  lockGrantTargetPeople,
  lockSetupCompletion,
} from "./repository";

/**
 * The one implementation of an instance-admin grant, shared by the God Mode `grant-admin`
 * route and the break-glass CLI (`cli.ts`; safety-and-runtime.md: "any future recovery CLI
 * must reuse its target eligibility and serialization"). The route adds its own actor,
 * session and step-up checks between the two halves; the CLI has none of those.
 */

/**
 * Under the shared 2026 serialization: setup must be complete and the target a real,
 * non-anonymous, unbanned user with exactly one active staff person. Locks person rows
 * before the user row, the same parent-first order as deactivation approval.
 */
export async function lockEligibleGrantTarget(
  tx: Transaction,
  targetUserId: string,
) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(2026)`);
  const [setup] = await lockSetupCompletion(tx);
  if (!setup?.completedAt)
    throw new HTTPException(409, { message: "Instance setup is incomplete" });
  const people = await lockGrantTargetPeople(tx, targetUserId);
  const [target] = await lockGrantTarget(tx, targetUserId);
  if (!target) throw new HTTPException(404, { message: "User not found" });
  if (
    target.anonymous ||
    target.banned ||
    people.length !== 1 ||
    people[0]?.side !== "staff" ||
    people[0]?.active !== true
  )
    throw new HTTPException(409, { message: "Target is not eligible" });
  return target;
}

/** Sets `role = 'admin'` and sends the in-app security alert to every admin plus the target. */
export async function applyInstanceAdminGrant(
  tx: Transaction,
  target: { id: string; role: string | null },
): Promise<"granted" | "already_admin"> {
  const result = target.role === "admin" ? "already_admin" : "granted";
  if (result === "granted")
    await tx
      .update(schema.userTable)
      .set({ role: "admin" })
      .where(eq(schema.userTable.id, target.id));
  const admins = await listAdminIds(tx);
  const recipients = [...new Set([...admins.map((row) => row.id), target.id])];
  await tx.insert(schema.notificationTable).values(
    recipients.map((userId) => ({
      userId,
      type: "security_alert",
      title: "Instance administrator authority changed",
      content:
        "An instance administrator grant operation was recorded. Review the instance audit log if you did not expect this change.",
      eventData:
        userId === target.id
          ? { kind: "instance_admin_granted" }
          : { kind: "instance_admin_granted", userId: target.id },
      resourceId: "singleton",
      resourceType: "instance",
    })),
  );
  return result;
}
