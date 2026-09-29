import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import hasCommentCapability from "../../comment/has-comment-capability";
import db from "../../database";
import { commentTable, workItemTable } from "../../database/schema";
import { publishEvent } from "../../events";
import type { ActivityActorType } from "../activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../assert-work-item-live";

export type CreateCommentInput = {
  body: unknown;
  visibility: "public" | "internal";
};

/**
 * `POST /api/work-items/{key}/comments` (`docs/03-features/comments-and-activity.md`).
 * `CA-1`: visibility is chosen explicitly at composition -- there is no default here, and
 * none in `createCommentBody` either (`comment-schema.ts`). The required capability
 * depends on that choice (rbac.md § Comments): `comment:create` for `public`,
 * `comment:create_internal` for `internal` -- so, like `PATCH /api/work-items/{key}`'s
 * `work_item:set_priority` branch, the check runs in the handler, after body validation,
 * not as route `middleware` (the body does not exist yet when `middleware` runs --
 * `openapi.ts`'s own comment).
 *
 * `work_item.first_response_at` (`SLA-7`, `work-items.md`) is NOT set here -- that
 * mechanism belongs to `work-items.md`'s own SLA slice, out of scope for this feature.
 */
export async function createComment(
  workItemId: string,
  workspaceId: string,
  actorId: string,
  actorType: ActivityActorType,
  input: CreateCommentInput,
) {
  const requiredCapability =
    input.visibility === "public"
      ? "comment:create"
      : "comment:create_internal";

  if (!(await hasCommentCapability(workspaceId, actorId, requiredCapability))) {
    throw new HTTPException(403, {
      message: `Missing ${requiredCapability} permission`,
    });
  }

  // Issue #493: this route had NO in-transaction liveness re-check at all --
  // `requireWorkItemReach()` checks `deletedAt`/`archivedAt` before this request reaches
  // here, but a soft-delete/archive landing in the window between that check and this
  // insert would otherwise still leave a comment (and its `work_item.commented` event) on
  // a dead item. `.for("share")` locks the row so a concurrent soft-delete blocks until
  // this transaction finishes, closing the same reach-check-to-write race #276 closed for
  // `update-work-item.ts` -- read-only here (nothing about THIS row is written), so a
  // shared lock is enough.
  const created = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({
        projectId: workItemTable.projectId,
        deletedAt: workItemTable.deletedAt,
        archivedAt: workItemTable.archivedAt,
      })
      .from(workItemTable)
      .where(eq(workItemTable.id, workItemId))
      .for("share");
    assertWorkItemStillLive(locked);
    await assertProjectStillLive(tx, locked.projectId);

    const [row] = await tx
      .insert(commentTable)
      .values({
        workspaceId,
        workItemId,
        authorId: actorId,
        actorType,
        body: input.body,
        visibility: input.visibility,
      })
      .returning();

    return row;
  });

  if (!created) {
    throw new HTTPException(500, { message: "Failed to create comment" });
  }

  // `docs/01-architecture/events.md` ~56: `work_item.commented` -- "A customer never
  // receives an `internal` fan-out" (`NO-19`), so `visibility` travels on the event
  // itself, exactly as `work_item.updated`'s own `changes[].visibility` does
  // (`update-work-item.ts`). Published after the insert, matching every other
  // `publishEvent` caller's after-write placement.
  await publishEvent("work_item.commented", {
    commentId: created.id,
    workItemId,
    workspaceId,
    visibility: created.visibility,
    actorId,
    actorType,
  });

  return created;
}

export default createComment;
