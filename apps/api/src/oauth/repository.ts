import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";

/** The stored ID token of a user's `custom` OAuth account, or `undefined` (issue #580). */
export async function findCustomAccountIdToken(
  userId: string,
): Promise<{ idToken: string | null } | undefined> {
  const [account] = await db
    .select({ idToken: schema.accountTable.idToken })
    .from(schema.accountTable)
    .where(
      and(
        eq(schema.accountTable.userId, userId),
        eq(schema.accountTable.providerId, "custom"),
      ),
    )
    .limit(1);
  return account;
}
