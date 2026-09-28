import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { commentTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { builtInRoleHasCapability } from "../../utils/require-workspace-capability";
import {
  isUnambiguousMembership,
  workspaceMemberRoles,
} from "../../utils/workspace-member-roles";
import type { ActivityActorType } from "../activity";

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

  const roles = await workspaceMemberRoles(db, workspaceId, actorId);
  if (
    !isUnambiguousMembership(roles) ||
    !(await builtInRoleHasCapability(workspaceId, roles[0], requiredCapability))
  ) {
    throw new HTTPException(403, {
      message: `Missing ${requiredCapability} permission`,
    });
  }

  const [created] = await db
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
