import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { announcementTable } from "../database/schema-p5-service";
import {
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import {
  announcementReachOfIdentity,
  assertAnnouncementDeletable,
  callerReachesAnnouncement,
  softDeleteAnnouncement,
} from "./repository";

export const ANNOUNCEMENT_DELETION_ROUTE =
  "DELETE /api/announcements/{id}" as const;

/**
 * `DELETE /api/announcements/{id}`: a click-confirmed pending action. Approval soft-deletes the
 * row (`deleted_at`), which hides it from staff lists and the portal, and audits
 * `announcement.deleted`. Registered in `registeredDeletionTargets()`. A notice with no target
 * in the caller's project reach answers 404, at request and at execution. Deleting a published
 * notice needs reach to every customer it addresses: the route refuses with 422 at request, and
 * execution checks again (409, the approval route's stale-target answer) in case the
 * requester's reach shrank before approval.
 */
export const announcementDeletionTarget: RegisteredDeletionTarget = {
  targetType: "announcement",
  routeKey: ANNOUNCEMENT_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Announcement not found",
  load: async (tx, id) => {
    const [row] = await tx
      .select()
      .from(announcementTable)
      .where(
        and(eq(announcementTable.id, id), isNull(announcementTable.deletedAt)),
      )
      .for("update")
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: null,
      organisationId: null,
      name: row.title,
      summary: { announcementId: row.id, name: row.title },
      version: registeredDeletionFingerprint(row),
    };
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [row] = await tx
      .select({
        id: announcementTable.id,
        workspaceId: announcementTable.workspaceId,
      })
      .from(announcementTable)
      .where(
        and(eq(announcementTable.id, id), isNull(announcementTable.deletedAt)),
      )
      .limit(1);
    return row
      ? {
          id: row.id,
          workspaceId: row.workspaceId,
          projectId: null,
          organisationId: null,
        }
      : undefined;
  },
  // The same rule as the staff routes: a notice with no target in the caller's reach is missing.
  callerReaches: async (tx, loaded, identity) =>
    loaded.workspaceId !== null &&
    callerReachesAnnouncement(tx, loaded.id, loaded.workspaceId, identity),
  execute: async (tx, { loaded, identity }) => {
    // The request passed this rule, so a refusal now means the requester's reach shrank: the
    // approval route's declared answer for a target that changed since the request is 409.
    try {
      await assertAnnouncementDeletable(
        tx,
        loaded.id,
        loaded.workspaceId,
        await announcementReachOfIdentity(tx, loaded.workspaceId, identity),
      );
    } catch (error) {
      if (error instanceof HTTPException && error.status === 422)
        throw new HTTPException(409, { message: error.message });
      throw error;
    }
    const deleted = await softDeleteAnnouncement(
      tx,
      loaded.id,
      loaded.workspaceId,
      { userId: identity.userId, actorType: "person" },
    );
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};
