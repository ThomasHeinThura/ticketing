import { HTTPException } from "hono/http-exception";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import {
  deleteEntryRow,
  entryExistsInWorkspace,
  entryUnderOpenHold,
  lockEntryForDeletion,
} from "./repository";

export const TIME_ENTRY_DELETION_ROUTE =
  "DELETE /api/time-entries/{id}" as const;

/**
 * Deleting a time entry is a click-level pending action (the requester confirms it). The route
 * policy's `orOwner` branch is evaluated at approval too: the row's person is passed as row
 * facts, so a member holding only `time_entry:delete_own` can approve deleting their own entry.
 */
export const timeEntryDeletionTarget: RegisteredDeletionTarget = {
  targetType: "time_entry",
  routeKey: TIME_ENTRY_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Time entry not found",
  load: async (tx, id) => {
    const entry = await lockEntryForDeletion(tx, id);
    if (!entry) return undefined;
    return {
      id: entry.id,
      workspaceId: entry.workspaceId,
      projectId: null,
      organisationId: null,
      name: `${entry.date} · ${entry.minutes} min`,
      summary: { entryId: entry.id, date: entry.date, minutes: entry.minutes },
      rowFacts: { personId: entry.personId },
      version: registeredDeletionFingerprint(entry),
    };
  },
  assertDeletable: async (tx, loaded) => {
    if (!(await entryExistsInWorkspace(tx, loaded.id, loaded.workspaceId)))
      throw new HTTPException(404, { message: "Time entry not found" });
    if (await entryUnderOpenHold(tx, loaded.id))
      throw new HTTPException(409, { message: "legal_hold" });
  },
  execute: async (tx, { loaded, identity }) => {
    if (await entryUnderOpenHold(tx, loaded.id))
      throw new HTTPException(409, { message: "legal_hold" });
    const deleted = await deleteEntryRow(tx, loaded.id, loaded.workspaceId, {
      userId: identity.userId,
      actorType: "person",
    });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};
