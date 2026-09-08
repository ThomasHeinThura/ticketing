import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

/**
 * The `DISABLE_WORKSPACE_CREATION` instance-admin gate, moved off the plugin
 * (`allowUserToCreateOrganization`, `apps/api/src/auth.ts`).
 *
 * The role is re-read from the database rather than taken from the session,
 * and the original reason is worth keeping: the first-user bootstrap promotes
 * the user to instance admin AFTER `signUpEmail` has already returned, so a
 * session minted at sign-up can still say `role: "user"`. The plugin's
 * comment notes the cookie cache made this load-bearing; that cache is now
 * disabled, so the fresh read is belt-and-braces — but it is still correct,
 * and removing it would be a behaviour change nobody asked for.
 *
 * The flag is read per request, matching `apps/api/src/utils/get-settings.ts`.
 * The plugin read it once at module load, which meant the constructed auth
 * config could not be re-gated without a restart.
 *
 * `requireSessionOnly()` (`apps/api/src/utils/require-session-only.ts`, #65)
 * is what refuses a non-session credential ahead of this middleware on the
 * create route now — this file no longer duplicates that check. An earlier
 * version of this file had its own `requireSession`, which only checked for
 * `session?.id` and answered a non-session caller with a generic `401`
 * rather than the `403 session_required` `requireSessionOnly()` gives every
 * other session-only route. Keeping a second, slightly different
 * implementation of the same restriction is exactly what the freeze
 * instructions for this batch forbid, so it was removed in favour of the one
 * #65 already built and proved.
 */
export async function requireWorkspaceCreationAllowed(c: Context, next: Next) {
  if (process.env.DISABLE_WORKSPACE_CREATION !== "true") {
    return next();
  }

  const userId = c.get("userId");
  if (!userId) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const [user] = await db
    .select({ role: schema.userTable.role })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);

  if (user?.role !== "admin") {
    throw new HTTPException(403, {
      message: "Workspace creation is disabled on this instance",
    });
  }

  return next();
}
