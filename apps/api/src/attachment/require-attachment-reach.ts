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
 * `GET /api/attachments/{id}` and `DELETE /api/attachments/{id}` middleware: resolves the
 * caller's workspace reach from the attachment's own id, via a genuine DB lookup, the same
 * shape `work-item/require-work-item-reach.ts` uses for `work_item.key`.
 *
 * Only ever reaches a `work_item_id`-attached row today (`../database/schema.ts`'s comment
 * on `attachmentTable`: `comment_id`/`submission_id` are reserved, unpopulated columns in
 * this slice), so this middleware 404s outright on a `comment_id`/`submission_id` row --
 * there is no such row to find yet, but the check is here so a future writer that starts
 * populating those columns does not silently fall through this middleware's join.
 *
 * A soft-deleted attachment (`state = 'deleted'`) still resolves here -- `DELETE` is
 * idempotent (deleting an already-deleted row is a no-op in the controller) and a deleted
 * row must still 404 exactly like a nonexistent one from the OUTSIDE (no distinguishing
 * "gone" from "never existed" to a caller without read access), which is why the download
 * route re-checks `state = 'ready'` itself rather than relying on this middleware to filter
 * it.
 */
export function requireAttachmentReach(idKey = "id") {
  return async (c: Context, next: Next) => {
    markShadowLegacyAuthorizationUnknown(c);
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    const id = c.req.param(idKey);
    if (!id) {
      throw new HTTPException(400, { message: "Missing attachment id" });
    }
    if (id.includes("\u0000")) {
      throw new HTTPException(400, { message: "Invalid attachment id" });
    }

    // Same "soft-deleted project freezes its rows" invariant `requireWorkItemReach`
    // enforces for a work item's own key.
    //
    // Issue #480: the work item's OWN `deleted_at`/`archived_at` are checked too, not
    // only its project's -- same gap `require-work-item-reach.ts` closed for #276, here
    // for the attachment-reach path, which has its own local lookup rather than going
    // through that middleware.
    const [row] = await db
      .select({
        id: schema.attachmentTable.id,
        workItemId: schema.attachmentTable.workItemId,
        workspaceId: schema.attachmentTable.workspaceId,
      })
      .from(schema.attachmentTable)
      .innerJoin(
        schema.workItemTable,
        eq(schema.attachmentTable.workItemId, schema.workItemTable.id),
      )
      .innerJoin(
        schema.projectTable,
        eq(schema.workItemTable.projectId, schema.projectTable.id),
      )
      .where(
        and(
          eq(schema.attachmentTable.id, id),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.workItemTable.archivedAt),
          isNull(schema.projectTable.deletedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw new HTTPException(404, { message: "Attachment not found" });
    }

    c.set("workspaceId", row.workspaceId);
    c.set("workspaceIdSource", "row");
    c.set("workItemId", row.workItemId);
    c.set("policyScopeResource", "work_item");

    const apiKey = c.get("apiKey");
    try {
      await validateWorkspaceAccess(userId, row.workspaceId, apiKey?.id);
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        setShadowLegacyAuthorization(c, "denied");
        throw new HTTPException(404, { message: "Attachment not found" });
      }
      throw error;
    }

    setShadowLegacyAuthorization(c, "allowed");
    return next();
  };
}

export default requireAttachmentReach;
