import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { personTable } from "../database/schema";

/**
 * `saved_view.created_by` (and `user_preference.person_id`) are `person.id`, this
 * codebase's canonical actor identity for organisation-scoped rows (`packages/permissions`'s
 * closed `OWNER_PREDICATES` vocabulary only has `row.created_by === identity.personId`) --
 * while the auth layer hands every route `c.get("userId")`. `person.user_id` carries a
 * global unique index (`person_user_unique`, `database/schema.ts`), so this is a single
 * indexed lookup, not a scan.
 *
 * Fails closed with 403 rather than 500: a caller with a valid session but no `person` row
 * (possible mid-provisioning, or for a user the boot seed never backfilled) has no
 * organisation-scoped identity to act as, so it cannot own or pin a view.
 */
export async function resolveCallerPersonId(userId: string): Promise<string> {
  const [row] = await db
    .select({ id: personTable.id })
    .from(personTable)
    .where(eq(personTable.userId, userId))
    .limit(1);

  if (!row) {
    throw new HTTPException(403, {
      message: "No organisation identity for this account",
    });
  }

  return row.id;
}
