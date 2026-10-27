import { count, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import type { Executor } from "../database/executor";
import type { DbTransaction } from "../events/outbox";
import {
  type RegisteredDeletionReadScope,
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";
import { appendIntakeAudit } from "./audit";
import {
  lockRequestTypeGroupOrder,
  synchronizeRequestTypeGroupOrder,
} from "./group-order";

export const REQUEST_TYPE_DELETION_ROUTE =
  "DELETE /api/request-types/{id}" as const;

/**
 * `P2R1-18` (feature-contracts-p2.md request types API and edge cases): deleting a request type
 * is a click-level pending action (PA-1; request types carry version history, so the PA-1a
 * exemptions do not apply). It is refused while the type is published (unpublish first), and
 * while any submission was ever made against it: every submission pins one of its form
 * versions (`submission_request_type_version_fk`, restrict), so deleting it would erase the
 * customer record. Both refusals are raised at request time and again at approval.
 */
export async function requestTypeDeletionBlockers(
  executor: Executor,
  id: string,
): Promise<string[]> {
  const [type] = await executor
    .select({ published: schema.requestTypeTable.published })
    .from(schema.requestTypeTable)
    .where(eq(schema.requestTypeTable.id, id))
    .limit(1);
  if (!type) return [];
  const blockers: string[] = [];
  if (type.published) blockers.push("request_type_published");
  const [used] = await executor
    .select({ n: count() })
    .from(schema.submissionTable)
    .where(eq(schema.submissionTable.requestTypeId, id));
  if (Number(used?.n ?? 0) > 0) blockers.push("request_type_has_submissions");
  return blockers;
}

export function requestTypeDeletionRefusal(blockers: readonly string[]) {
  const code = blockers[0] ?? "request_type_not_deletable";
  return new HTTPException(409, {
    res: Response.json(
      {
        error: code,
        message:
          code === "request_type_published"
            ? "Unpublish the request type before deleting it"
            : "Request types with submissions cannot be deleted; unpublish it instead",
      },
      { status: 409 },
    ),
  });
}

export const requestTypeDeletionTarget: RegisteredDeletionTarget = {
  targetType: "request_type",
  routeKey: REQUEST_TYPE_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Request type not found",
  load: async (tx, id) => {
    const [scope] = await tx
      .select({ workspaceId: schema.requestTypeTable.workspaceId })
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .limit(1);
    if (!scope) return undefined;
    // Same lock order as every request-type writer: workspace and group order, then the row.
    await lockRequestTypeGroupOrder(
      tx as unknown as DbTransaction,
      scope.workspaceId,
    );
    const [type] = await tx
      .select()
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .for("update")
      .limit(1);
    if (!type) return undefined;
    return {
      id: type.id,
      workspaceId: type.workspaceId,
      projectId: null,
      organisationId: null,
      name: type.name,
      summary: { requestTypeId: type.id, key: type.key, name: type.name },
      version: registeredDeletionFingerprint(type),
    };
  },
  readScope: async (
    tx,
    id,
  ): Promise<RegisteredDeletionReadScope | undefined> => {
    const [type] = await tx
      .select({
        id: schema.requestTypeTable.id,
        workspaceId: schema.requestTypeTable.workspaceId,
      })
      .from(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, id))
      .limit(1);
    return type
      ? {
          id: type.id,
          workspaceId: type.workspaceId,
          projectId: null,
          organisationId: null,
        }
      : undefined;
  },
  assertDeletable: async (tx, loaded) => {
    const blockers = await requestTypeDeletionBlockers(
      tx as unknown as Executor,
      loaded.id,
    );
    if (blockers.length > 0) throw requestTypeDeletionRefusal(blockers);
  },
  execute: async (tx, { loaded, identity }) => {
    const executor = tx as unknown as DbTransaction;
    await executor
      .delete(schema.organisationRequestTypeTable)
      .where(eq(schema.organisationRequestTypeTable.requestTypeId, loaded.id));
    await executor
      .delete(schema.requestTypeVersionTable)
      .where(eq(schema.requestTypeVersionTable.requestTypeId, loaded.id));
    const deleted = await executor
      .delete(schema.requestTypeTable)
      .where(eq(schema.requestTypeTable.id, loaded.id))
      .returning({ id: schema.requestTypeTable.id });
    if (deleted.length === 0)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    await synchronizeRequestTypeGroupOrder(executor, loaded.workspaceId);
    await appendIntakeAudit(executor, {
      actorId: identity.personId,
      actorType: "person",
      workspaceId: loaded.workspaceId,
      action: "request_type.deleted",
      entityType: "request_type",
      entityId: loaded.id,
      before: { name: loaded.name },
    });
    return {};
  },
};
