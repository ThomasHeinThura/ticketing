import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";

/**
 * A caller whose workspace role is `customer`, or whose person is customer-side. Customers
 * are portal-only (`rbac.md` § "The customer role is special"); the permission matrix
 * declares `403 forbidden` for them on every item-scoped agent route even inside reach.
 */
export async function isCustomerPrincipal(
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const [membership] = await db
    .select({ role: schema.workspaceUserTable.role })
    .from(schema.workspaceUserTable)
    .where(
      and(
        eq(schema.workspaceUserTable.userId, userId),
        eq(schema.workspaceUserTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (membership?.role === "customer") return true;
  const [person] = await db
    .select({ side: schema.personTable.side })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  return person?.side === "customer";
}

/** Whether the caller's person is customer-side (portal identities), independent of workspace. */
export async function isCustomerSidePerson(userId: string): Promise<boolean> {
  const [person] = await db
    .select({ side: schema.personTable.side })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  return person?.side === "customer";
}
