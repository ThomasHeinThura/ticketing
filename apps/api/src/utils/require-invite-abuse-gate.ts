import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { isCloud } from "./is-cloud";
import { isDisposableEmail } from "./is-disposable-email";

/**
 * The native equivalent of `auth.ts`'s `ctx.path === "/organization/
 * invite-member" && isCloud()` cloud abuse gate, moved onto
 * `POST /api/workspace/{id}/invitations` (retrofit plan §3, S6a row; R1).
 * Refuses an invitation from an anonymous caller, or to a disposable-email
 * address, on cloud deployments only -- self-hosted instances are
 * unaffected, exactly like the plugin gate it mirrors.
 *
 * ONE DELIBERATE IMPROVEMENT, not a redesign: the plugin gate reads
 * `sessionUser.isAnonymous` off `getSessionFromCtx`'s better-auth-serialized
 * user, which only carries fields declared as a plugin `additionalField`.
 * `isAnonymous` was contributed by the `anonymous()` plugin, and that plugin
 * was REMOVED in #6 (`apps/api/src/auth.ts`'s `plugins` array) -- so
 * `user.isAnonymous` is no longer part of the compiled `User` schema at all,
 * and `organization-invite-abuse-guards.test.ts` already characterizes the
 * resulting branch as UNREACHABLE on this baseline ("#6 removed anonymous()
 * sign-in"). `apps/api/src/utils/authenticate-api-request.ts` populates
 * `c.get("user")` from that same serialized `auth.api.getSession()` call, so
 * a native middleware that only read `c.get("user")?.isAnonymous` would
 * inherit the identical dead branch. This one instead reads the
 * `user.is_anonymous` COLUMN directly -- the column still exists
 * (`apps/api/src/database/schema.ts`) and is never dropped by removing a
 * plugin -- so the check stays live (defence in depth "if guest access ever
 * returns", exactly the case that test's own comment names) rather than
 * silently inheriting the plugin path's blind spot.
 */
export function requireInviteAbuseGate() {
  return async (c: Context, next: Next) => {
    if (!isCloud()) {
      return next();
    }

    if (await isAnonymousCaller(c)) {
      throw new HTTPException(403, {
        message: "Guest accounts may not send workspace invitations.",
      });
    }

    // Read the body without consuming the stream for the route's own zod
    // validator: Hono's Request caches a parsed JSON body after the first
    // `.json()` call, so a second parse (the validator's, once this
    // middleware's `next()` runs) sees the same cached value rather than an
    // already-drained stream. `workspace-access-middleware.ts`'s
    // `readJsonObjectBody` relies on the exact same caching for its `fromBody`
    // sources, ahead of the same kind of per-route zod validator.
    const body = await c.req.json().catch(() => null);
    const email =
      body && typeof body === "object" && "email" in body
        ? (body as { email?: unknown }).email
        : undefined;

    if (typeof email === "string" && isDisposableEmail(email)) {
      throw new HTTPException(400, {
        message: "Invitations to disposable-email addresses are not allowed.",
      });
    }

    return next();
  };
}

async function isAnonymousCaller(c: Context): Promise<boolean> {
  const user = c.get("user") as
    | { isAnonymous?: boolean | null }
    | null
    | undefined;
  if (typeof user?.isAnonymous === "boolean") {
    return user.isAnonymous;
  }

  const userId = c.get("userId");
  if (!userId) return false;

  const [row] = await db
    .select({ isAnonymous: schema.userTable.isAnonymous })
    .from(schema.userTable)
    .where(eq(schema.userTable.id, userId))
    .limit(1);

  return row?.isAnonymous ?? false;
}
