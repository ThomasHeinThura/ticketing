import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { serviceTable } from "../database/schema-p5-service";
import {
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import {
  deleteServiceRow,
  serviceDeletionBlockers,
} from "./service-repository";

export const SERVICE_DELETION_ROUTE = "DELETE /api/services/{id}" as const;

/**
 * Deleting a service is a click-level pending action, refused while it has open changes, releases
 * or dependents. The refusal is raised at request time and again at approval.
 *
 * Registered in `registeredDeletionTargets()` (pending-action/deletion-targets.ts).
 */
export const serviceDeletionTarget: RegisteredDeletionTarget = {
  targetType: "service",
  routeKey: SERVICE_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Service not found",
  load: async (tx, id) => {
    const [service] = await tx
      .select()
      .from(serviceTable)
      .where(eq(serviceTable.id, id))
      .for("update")
      .limit(1);
    if (!service) return undefined;
    return {
      id: service.id,
      workspaceId: service.workspaceId,
      projectId: null,
      organisationId: null,
      name: service.name,
      summary: { serviceId: service.id, name: service.name },
      version: registeredDeletionFingerprint(service),
    };
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [service] = await tx
      .select({ id: serviceTable.id, workspaceId: serviceTable.workspaceId })
      .from(serviceTable)
      .where(eq(serviceTable.id, id))
      .limit(1);
    return service
      ? {
          id: service.id,
          workspaceId: service.workspaceId,
          projectId: null,
          organisationId: null,
        }
      : undefined;
  },
  assertDeletable: async (tx, loaded) => {
    const [service] = await tx
      .select({ id: serviceTable.id })
      .from(serviceTable)
      .where(
        and(
          eq(serviceTable.id, loaded.id),
          eq(serviceTable.workspaceId, loaded.workspaceId),
        ),
      )
      .limit(1);
    if (!service) return;
    const blockers = await serviceDeletionBlockers(
      tx,
      loaded.id,
      loaded.workspaceId,
    );
    if (blockers.length > 0)
      throw new HTTPException(409, { message: blockers.join(" ") });
  },
  execute: async (tx, { loaded, identity }) => {
    const deleted = await deleteServiceRow(tx, loaded.id, loaded.workspaceId, {
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
