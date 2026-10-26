import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { cycleTable, moduleTable } from "../database/schema-p5-agile";
import {
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { cycleUnderOpenHold, deleteCycleRow } from "./cycle.repository";
import { lockItemsOfCycle } from "./item-facts.repository";
import { deleteModuleRow } from "./module.repository";
import { lockCycle, lockModule } from "./scope.repository";

export const CYCLE_DELETION_ROUTE = "DELETE /api/cycles/{id}" as const;
export const MODULE_DELETION_ROUTE = "DELETE /api/modules/{id}" as const;

/**
 * Deleting a cycle or module is a click-level pending action. Items keep existing: their pointer
 * is cleared before the row goes (the composite foreign key is NO ACTION, never SET NULL, which
 * would null the item's project). A cycle's scope log and snapshots go with it.
 *
 * Registered in `registeredDeletionTargets()` (pending-action/deletion-targets.ts).
 */
export const cycleDeletionTarget: RegisteredDeletionTarget = {
  targetType: "cycle",
  routeKey: CYCLE_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Cycle not found",
  load: async (tx, id) => {
    const cycle = await lockCycle(tx, id);
    if (!cycle) return undefined;
    return {
      id: cycle.id,
      workspaceId: cycle.workspaceId,
      projectId: cycle.projectId,
      organisationId: null,
      name: cycle.name,
      summary: {
        cycleId: cycle.id,
        name: cycle.name,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
      },
      version: registeredDeletionFingerprint(cycle),
    };
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [cycle] = await tx
      .select({
        id: cycleTable.id,
        workspaceId: cycleTable.workspaceId,
        projectId: cycleTable.projectId,
      })
      .from(cycleTable)
      .where(eq(cycleTable.id, id))
      .limit(1);
    return cycle
      ? {
          id: cycle.id,
          workspaceId: cycle.workspaceId,
          projectId: cycle.projectId,
          organisationId: null,
        }
      : undefined;
  },
  assertDeletable: async (tx, loaded) => {
    if (await cycleUnderOpenHold(tx, loaded.id))
      throw new HTTPException(409, { message: "legal_hold" });
  },
  execute: async (tx, { loaded, identity }) => {
    // Lock order: items before the cycle (see `lockItemsByKeys`).
    await lockItemsOfCycle(tx, loaded.id);
    const cycle = await lockCycle(tx, loaded.id);
    if (!cycle)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    if (await cycleUnderOpenHold(tx, cycle.id))
      throw new HTTPException(409, { message: "legal_hold" });
    const deleted = await deleteCycleRow(tx, cycle, {
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

export const moduleDeletionTarget: RegisteredDeletionTarget = {
  targetType: "module",
  routeKey: MODULE_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Module not found",
  load: async (tx, id) => {
    const mod = await lockModule(tx, id);
    if (!mod) return undefined;
    return {
      id: mod.id,
      workspaceId: mod.workspaceId,
      projectId: mod.projectId,
      organisationId: null,
      name: mod.name,
      summary: { moduleId: mod.id, name: mod.name },
      version: registeredDeletionFingerprint(mod),
    };
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [mod] = await tx
      .select({
        id: moduleTable.id,
        workspaceId: moduleTable.workspaceId,
        projectId: moduleTable.projectId,
      })
      .from(moduleTable)
      .where(eq(moduleTable.id, id))
      .limit(1);
    return mod
      ? {
          id: mod.id,
          workspaceId: mod.workspaceId,
          projectId: mod.projectId,
          organisationId: null,
        }
      : undefined;
  },
  execute: async (tx, { loaded, identity }) => {
    const mod = await lockModule(tx, loaded.id);
    if (!mod)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    const deleted = await deleteModuleRow(tx, mod, {
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
