import { eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { validateWorkspaceAccess } from "../utils/validate-workspace-access";

/**
 * `GET /api/work-items/{key}` middleware: resolves the caller's workspace reach from the
 * work item's own key, via a genuine DB lookup, and sets `workspaceId` in context for
 * `requireWorkspaceCapability` to read next.
 *
 * A LOCAL middleware, not an addition to the shared `workspace-access-middleware.ts`
 * (`workspaceAccess.fromProject`/`fromTaskId`/etc.), deliberately -- see #20 in
 * `AGENTS.md`'s do-not list ("let two lanes edit the same file... concurrently") and this
 * project's own "partition by file" guidance. It also behaves DIFFERENTLY from every
 * `workspaceAccess.*` lookup source: those return a generic `400 Workspace ID could not
 * be determined` when the looked-up id doesn't resolve (`get-project.ts`'s own route
 * docs this for an unknown project id) -- but this task's own verification requirement is
 * explicit: "the two read routes return ... 404 on a nonexistent key". A `work_item.key`
 * that resolves to no row is a genuinely missing RESOURCE, not a malformed request, so
 * this middleware 404s instead of reusing the generic-lookup 400.
 *
 * `validateWorkspaceAccess` still governs "exists, but caller isn't a member of its
 * workspace" -- that stays a 403, matching this codebase's established, live behaviour
 * for every other `workspaceAccess.*`-gated route (`validate-workspace-access.ts` throws
 * 403, unconditionally, for a non-member; there is no 404-for-out-of-reach path live
 * anywhere in this codebase today, despite `rbac.md`'s stated target design -- the same
 * declared-target-vs-runtime-reality gap `workspace/policy.ts`'s file comment already
 * documents elsewhere). Changing that broader gap is out of this slice's scope.
 */
export function requireWorkItemReach(idKey = "key") {
  return async (c: Context, next: Next) => {
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const key = c.req.param(idKey);
    if (!key) {
      throw new HTTPException(400, { message: "Missing work item key" });
    }

    const [workItem] = await db
      .select({ workspaceId: schema.workItemTable.workspaceId })
      .from(schema.workItemTable)
      .where(eq(schema.workItemTable.key, key))
      .limit(1);

    if (!workItem) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    const apiKey = c.get("apiKey");
    await validateWorkspaceAccess(userId, workItem.workspaceId, apiKey?.id);

    c.set("workspaceId", workItem.workspaceId);

    return next();
  };
}
