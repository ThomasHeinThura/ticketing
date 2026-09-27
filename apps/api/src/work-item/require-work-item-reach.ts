import { and, eq, isNull } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import {
  markShadowLegacyAuthorizationUnknown,
  setShadowLegacyAuthorization,
} from "../permissions/shadow-context";
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
 * workspace" -- but UNLIKE every other `workspaceAccess.*`-gated route in this codebase,
 * that is answered here with 404, not 403 (#23's mandatory Opus security review of PR
 * #261, finding F2). `work_item.key` is `{project.slug}-{number}` -- low-entropy and
 * guessable, the first such identifier in this codebase (contrast the cuid2 every other
 * `workspaceAccess.*`-gated route addresses, where #8's own Opus review found "no
 * enumeration primitive"). A 403-vs-404 split on a guessable key lets a caller enumerate,
 * across the whole instance and without ever touching a tenant they belong to, which
 * project slugs exist anywhere and roughly how many work items each holds. It also
 * disagreed with `tests/permissions/matrix.fixture.json`, which this same PR regenerated
 * and which already declares `"outOfReach": "404 not_found"` for every role on this
 * route -- the declared answer and the live answer must not disagree (the whole reason
 * `require-workspace-capability.ts`'s policy-registry machinery exists). So a 403 from
 * `validateWorkspaceAccess` here is caught and re-thrown as 404, making "not yours" and
 * "not there" indistinguishable from the outside -- this route deliberately does NOT
 * match the broader "no 404-for-out-of-reach path live anywhere in this codebase today"
 * gap `workspace/policy.ts`'s file comment documents elsewhere: this route is new, owns
 * its own middleware, and its identifier is newly guessable, so closing the gap here does
 * not require touching the shared `workspace-access-middleware.ts` other routes still use.
 */
export function requireWorkItemReach(idKey = "key") {
  return async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const key = c.req.param(idKey);
    if (!key) {
      throw new HTTPException(400, { message: "Missing work item key" });
    }
    // T4 (independent Opus security review of PR #271, delta round): a NUL byte in `key`
    // reached the `eq(schema.workItemTable.key, key)` lookup below unvalidated -- Postgres
    // `text` rejects a NUL outright, so this used to throw an unhandled error and 500
    // before `workItemKeyParam`'s own schema (`schema.ts`) ever gets a chance to run: this
    // middleware is registered ahead of the request validators (`openapi.ts`'s own
    // comment), and reads the raw, unvalidated param for exactly that reason. Answered as
    // 400, the same as the adjacent "missing key" check above, since a NUL-bearing key is
    // a malformed request, not a missing resource -- consistent with this route already
    // treating an empty key as 400, not 404.
    if (key.includes("\u0000")) {
      throw new HTTPException(400, { message: "Invalid work item key" });
    }

    // #202 / PR #204's freeze invariant: a soft-deleted project's rows are frozen for
    // its 30-day recovery window, answered as 404 everywhere the subject resolves to a
    // project (`task/index.ts`'s upload-URL guard, `getProjectWorkspaceId`'s doc comment
    // in `utils/assert-assignable-user.ts`, and this route's own sibling,
    // `create-work-item.ts`'s `isNull(projectTable.deletedAt)` filter). `work_item`
    // belongs to exactly one project, so the inner join + `isNull` filter is applied
    // directly here (as `task/index.ts`'s own upload-URL guard does, rather than through
    // `getProjectWorkspaceId`, which takes a project id, not a work-item key) -- a
    // soft-deleted project's work item now 404s exactly like a nonexistent key, never
    // distinguishing the two from the outside, consistent with F2 above.
    // Issue #8, Slice 2: `id` and `projectId` are added to this SAME select -- no new
    // query, no new round trip -- so the shadow middleware's `RowScope` construction can
    // see a genuine, already-loaded work-item/project scope for this route. Read only by
    // `apps/api/src/permissions/shadow-middleware.ts`; the legacy check below still reads
    // `workItem.workspaceId` alone, unchanged.
    const [workItem] = await db
      .select({
        id: schema.workItemTable.id,
        projectId: schema.workItemTable.projectId,
        workspaceId: schema.workItemTable.workspaceId,
      })
      .from(schema.workItemTable)
      .innerJoin(
        schema.projectTable,
        eq(schema.workItemTable.projectId, schema.projectTable.id),
      )
      .where(
        and(
          eq(schema.workItemTable.key, key),
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .limit(1);

    if (!workItem) {
      throw new HTTPException(404, { message: "Work item not found" });
    }

    // Shadow-only facts from this authoritative row. Expose them before reach validation
    // so a denied request can still be compared against its declared row scope. These
    // context values do not affect the legacy decision below.
    c.set("workspaceId", workItem.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("workItemId", workItem.id);
    c.set("projectId", workItem.projectId);

    const apiKey = c.get("apiKey");
    try {
      await validateWorkspaceAccess(userId, workItem.workspaceId, apiKey?.id);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(404, { message: "Work item not found" });
      }
      throw error;
    }

    setShadowLegacyAuthorization(c, "allowed");
    return next();
  };
}
