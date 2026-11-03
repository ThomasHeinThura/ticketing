import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";
import { resolveOptionalCookieSession } from "../utils/authenticate-api-request";

/**
 * CP-19: the active customer person behind the portal session cookie on this request, or null.
 * The portal-bound storage routes compare it with the person their signed token was minted for,
 * so a copied link does not work for anyone else. Explicit API keys never substitute.
 */
export async function portalSessionPersonId(
  headers: Headers,
): Promise<string | null> {
  const session = await resolveOptionalCookieSession(headers);
  const userId = session?.user?.id;
  if (!userId) return null;
  const [person] = await db
    .select({ id: schema.personTable.id })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  return person?.id ?? null;
}
