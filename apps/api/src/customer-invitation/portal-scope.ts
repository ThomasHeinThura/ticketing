import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

/** A customer session of an active customer person; the person's own organisation is the scope. */
export async function portalAcceptScope(c: Context, next: Next) {
  const userId = c.get("userId") as string | undefined;
  if (!userId) throw new HTTPException(401, { message: "Unauthorized" });
  const [person] = await db
    .select({ organisationId: schema.personTable.organisationId })
    .from(schema.personTable)
    .where(
      and(
        eq(schema.personTable.userId, userId),
        eq(schema.personTable.side, "customer"),
        eq(schema.personTable.active, true),
      ),
    )
    .limit(1);
  if (!person)
    throw new HTTPException(404, { message: "Invitation not found" });
  c.set("portalPredicateSatisfied", true);
  c.set("policyOrganisationId", person.organisationId);
  c.set("policyOrganisationIdSource", "row");
  await next();
}
