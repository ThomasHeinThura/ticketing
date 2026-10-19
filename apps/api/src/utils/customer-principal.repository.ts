import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";

/** Query ownership for customer-principal checks (issue #580), moved verbatim. */

/** The user's workspace role in `workspaceId`, or `undefined` when not a member. */
export async function findWorkspaceMemberRole(
  userId: string,
  workspaceId: string,
) {
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
  return membership;
}

/** The side (`staff` / `customer`) of the user's person, or `undefined` without a person. */
export async function findPersonSide(userId: string) {
  const [person] = await db
    .select({ side: schema.personTable.side })
    .from(schema.personTable)
    .where(eq(schema.personTable.userId, userId))
    .limit(1);
  return person;
}
