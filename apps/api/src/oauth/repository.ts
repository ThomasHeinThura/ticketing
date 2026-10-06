import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";

export function getCustomProviderIdToken(userId: string) {
  return db
    .select({ idToken: schema.accountTable.idToken })
    .from(schema.accountTable)
    .where(
      and(
        eq(schema.accountTable.userId, userId),
        eq(schema.accountTable.providerId, "custom"),
      ),
    )
    .limit(1);
}
