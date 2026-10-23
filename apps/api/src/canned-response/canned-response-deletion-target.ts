import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { schema } from "../database";
import {
  type RegisteredDeletionTarget,
  registeredDeletionFingerprint,
} from "../pending-action/click-deletion-executor";

export const CANNED_RESPONSE_DELETION_ROUTE =
  "DELETE /api/canned-responses/{id}" as const;

/** `DELETE /api/canned-responses/{id}`: click-confirmed hard delete of one canned response. */
export const cannedResponseDeletionTarget: RegisteredDeletionTarget = {
  targetType: "canned_response",
  routeKey: CANNED_RESPONSE_DELETION_ROUTE,
  confirmation: "click",
  sessionOnly: false,
  notFound: "Canned response not found",
  load: async (tx, id) => {
    const [row] = await tx
      .select()
      .from(schema.cannedResponseTable)
      .where(eq(schema.cannedResponseTable.id, id))
      .for("update")
      .limit(1);
    if (!row) return undefined;
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      projectId: null,
      organisationId: null,
      name: row.name,
      summary: { cannedResponseId: row.id, name: row.name },
      version: registeredDeletionFingerprint(row),
    };
  },
  execute: async (tx, { loaded }) => {
    const [deleted] = await tx
      .delete(schema.cannedResponseTable)
      .where(
        and(
          eq(schema.cannedResponseTable.id, loaded.id),
          eq(schema.cannedResponseTable.workspaceId, loaded.workspaceId),
        ),
      )
      .returning({ id: schema.cannedResponseTable.id });
    if (!deleted)
      throw new HTTPException(409, {
        message: "pending_action_target_changed",
      });
    return {};
  },
};
