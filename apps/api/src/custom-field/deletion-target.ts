import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { customFieldTable } from "../database/migration-schema";
import {
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { dependentFieldKeys, softDeleteField } from "./repository";

export const CUSTOM_FIELD_DELETION_ROUTE =
  "DELETE /api/custom-fields/{id}" as const;

/**
 * CF-8: deleting a field is a click-level pending action that soft-deletes it. Values are retained
 * and restorable for 30 days. A field that other fields' visibility conditions reference cannot be
 * deleted: the refusal lists them (contract edge case), at request time and again at approval.
 *
 * Registered in `registeredDeletionTargets()` (pending-action/deletion-targets.ts) by the
 * coordinator.
 */
export const customFieldDeletionTarget: RegisteredDeletionTarget = {
  targetType: "custom_field",
  routeKey: CUSTOM_FIELD_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Custom field not found",
  load: async (tx, id) => {
    const [field] = await tx
      .select()
      .from(customFieldTable)
      .where(eq(customFieldTable.id, id))
      .for("update")
      .limit(1);
    if (!field || field.deletedAt !== null) return undefined;
    return {
      id: field.id,
      workspaceId: field.workspaceId,
      projectId: null,
      organisationId: null,
      name: field.name,
      summary: { customFieldId: field.id, key: field.key, name: field.name },
      version: registeredDeletionFingerprint(field),
    };
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [field] = await tx
      .select({
        id: customFieldTable.id,
        workspaceId: customFieldTable.workspaceId,
      })
      .from(customFieldTable)
      .where(
        and(eq(customFieldTable.id, id), isNull(customFieldTable.deletedAt)),
      )
      .limit(1);
    return field
      ? {
          id: field.id,
          workspaceId: field.workspaceId,
          projectId: null,
          organisationId: null,
        }
      : undefined;
  },
  assertDeletable: async (tx, loaded) => {
    const [field] = await tx
      .select({ key: customFieldTable.key, id: customFieldTable.id })
      .from(customFieldTable)
      .where(
        and(
          eq(customFieldTable.id, loaded.id),
          eq(customFieldTable.workspaceId, loaded.workspaceId),
        ),
      )
      .limit(1);
    if (!field) return;
    const dependents = await dependentFieldKeys(tx, loaded.workspaceId, field);
    if (dependents.length > 0)
      throw new HTTPException(409, {
        message: `Fields whose visibility depends on "${field.key}": ${dependents.join(", ")}. Remove those conditions first.`,
      });
  },
  execute: async (tx, { loaded, identity }) => {
    const deleted = await softDeleteField(tx, loaded.id, loaded.workspaceId, {
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
