import { HTTPException } from "hono/http-exception";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import {
  liveChildCount,
  lockPageForDeletion,
  softDeletePage,
} from "./repository";

export const PAGE_DELETION_ROUTE =
  "DELETE /api/projects/{projectId}/pages/{id}" as const;

const HAS_CHILDREN = "Move or delete this page's sub-pages first";

/**
 * PG-7: deleting a page is a click-level pending action. Approval soft-deletes the page (its
 * versions stay) and starts the restore window. A page with live sub-pages is refused at request
 * time and again at approval: they must be moved first, so no page is silently re-parented.
 *
 * Registered in `registeredDeletionTargets()` (pending-action/deletion-targets.ts).
 */
export const pageDeletionTarget: RegisteredDeletionTarget = {
  targetType: "project_page",
  routeKey: PAGE_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Not found",
  load: async (tx, id) => {
    const page = await lockPageForDeletion(tx, id);
    if (!page) return undefined;
    return {
      id: page.id,
      workspaceId: page.workspaceId,
      projectId: page.projectId,
      organisationId: null,
      name: page.title,
      summary: { pageId: page.id, title: page.title },
      version: registeredDeletionFingerprint({
        id: page.id,
        version: page.version,
        deletedAt: page.deletedAt,
      }),
    };
  },
  assertDeletable: async (tx, loaded) => {
    if ((await liveChildCount(tx, loaded.id)) > 0)
      throw new HTTPException(409, { message: HAS_CHILDREN });
  },
  execute: async (tx, { loaded, identity }) => {
    const page = await lockPageForDeletion(tx, loaded.id);
    if (!page)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    // lockPageForDeletion took the project tree lock (as a move does) before the row lock: a move
    // under this page either committed before this count or waits and then finds it deleted.
    if ((await liveChildCount(tx, page.id)) > 0)
      throw new HTTPException(409, { message: HAS_CHILDREN });
    const deleted = await softDeletePage(tx, page, {
      userId: identity.userId,
      personId: identity.personId,
      actorType: "person",
      apiKeyId: null,
    });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};
