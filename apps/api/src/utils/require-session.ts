import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";

/**
 * Require a real user session, not an API key.
 *
 * WHY THIS EXISTS (retrofit plan risk R10). `enableSessionForAPIKeys: false`
 * (`apps/api/src/auth.ts`) means an API key never became a better-auth
 * session, so the inherited `/organization/*` routes were effectively
 * session-only. Every route mounted under the global guard in
 * `apps/api/src/index.ts` authenticates API keys too — so moving workspace
 * creation, update and deletion to native routes would make them API-key
 * reachable for the FIRST time, silently, as a side effect of the move.
 *
 * This preserves the inherited reachability rather than widening it. It is
 * NOT a route-policy declaration: the `sessionOnly` decision and its registry
 * belong to #7 (retrofit plan §3.1 item 3), and nothing is declared here.
 */
export async function requireSession(c: Context, next: Next) {
  const session = c.get("session") as { id?: string } | null | undefined;
  if (!session?.id) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
  c.set("sessionId", session.id);
  return next();
}

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
