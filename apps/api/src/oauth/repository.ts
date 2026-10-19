import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";

/** The account token is selected only for the authenticated user that owns it. */
export async function findCustomProviderIdToken(userId: string) {
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
  return account?.idToken ?? null;
}
