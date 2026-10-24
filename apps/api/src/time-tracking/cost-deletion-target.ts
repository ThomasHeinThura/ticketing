import { HTTPException } from "hono/http-exception";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import {
  costEntryExistsInWorkspace,
  costEntryUnderOpenHold,
  deleteCostEntryRow,
  lockCostEntryForDeletion,
} from "./cost-repository";

export const COST_ENTRY_DELETION_ROUTE =
  "DELETE /api/cost-entries/{id}" as const;

/**
 * Deleting a cost entry is a click-level pending action. The route policy needs
 * `time_entry:manage_rates`, re-evaluated at approval; an open legal hold on the person the cost
 * is for (or the user who recorded it) refuses the delete at request and again at execution.
 */
export const costEntryDeletionTarget: RegisteredDeletionTarget = {
  targetType: "cost_entry",
  routeKey: COST_ENTRY_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Cost entry not found",
  load: async (tx, id) => {
    const entry = await lockCostEntryForDeletion(tx, id);
    if (!entry) return undefined;
    return {
      id: entry.id,
      workspaceId: entry.workspaceId,
      projectId: null,
      organisationId: null,
      // The label never carries an amount: a pending-action reader must not learn a price.
      name: `${entry.date} · ${entry.units} unit${entry.units === 1 ? "" : "s"}`,
      summary: { entryId: entry.id, date: entry.date, units: entry.units },
      rowFacts: { personId: entry.personId },
      version: registeredDeletionFingerprint(entry),
    };
  },
  assertDeletable: async (tx, loaded) => {
    if (!(await costEntryExistsInWorkspace(tx, loaded.id, loaded.workspaceId)))
      throw new HTTPException(404, { message: "Cost entry not found" });
    if (await costEntryUnderOpenHold(tx, loaded.id))
      throw new HTTPException(409, { message: "legal_hold" });
  },
  execute: async (tx, { loaded, identity }) => {
    if (await costEntryUnderOpenHold(tx, loaded.id))
      throw new HTTPException(409, { message: "legal_hold" });
    const deleted = await deleteCostEntryRow(
      tx,
      loaded.id,
      loaded.workspaceId,
      {
        userId: identity.userId,
        actorType: "person",
      },
    );
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};
