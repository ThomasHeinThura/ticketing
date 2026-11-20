import { isDeepStrictEqual } from "node:util";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { AppendAuditLogInput } from "../../audit/audit-writer";
import db from "../../database";
import { currentWorkspaceReachPredicate } from "../../database/repositories/identity-scope.repository";
import { cannedResponseTable } from "../../database/schema";
import { appendAuditSavepoint } from "../../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import {
  type CannedResponseChanges,
  updateCannedResponseInWorkspace,
} from "../repository";

export type UpdateCannedResponseInput = {
  name?: string;
  body?: unknown;
  visibilityDefault?: "public" | "internal";
};

export async function updateCannedResponse(
  identity: ResolvedIdentity,
  id: string,
  workspaceId: string,
  input: UpdateCannedResponseInput,
  actor: Pick<
    AppendAuditLogInput,
    | "actorId"
    | "actorType"
    | "apiKeyId"
    | "impersonatorId"
    | "actorIp"
    | "userAgent"
    | "traceId"
  >,
) {
  const values: CannedResponseChanges = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.body !== undefined) values.body = input.body;
  if (input.visibilityDefault !== undefined) {
    values.visibilityDefault = input.visibilityDefault;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(cannedResponseTable)
        .where(
          and(
            eq(cannedResponseTable.id, id),
            eq(cannedResponseTable.workspaceId, workspaceId),
            currentWorkspaceReachPredicate(
              identity,
              cannedResponseTable.workspaceId,
              tx,
            ),
          ),
        )
        .for("update")
        .limit(1);
      if (!before)
        throw new HTTPException(404, { message: "Canned response not found" });
      const changedFields = (
        Object.keys(values) as Array<keyof CannedResponseChanges>
      ).filter((field) => !isDeepStrictEqual(values[field], before[field]));
      if (!changedFields.length) return { updated: before, auditFailed: false };
      const updated = await updateCannedResponseInWorkspace(
        identity,
        id,
        workspaceId,
        values,
        tx,
      );
      if (!updated)
        throw new HTTPException(404, { message: "Canned response not found" });
      const auditFailed = await appendAuditSavepoint(tx, {
        ...actor,
        workspaceId,
        action: "canned_response.updated",
        entityType: "canned_response",
        entityId: id,
        after: { changedFields },
      });
      return { updated, auditFailed };
    });
    if (result.auditFailed)
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    return result.updated;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (isUniqueViolation(error, "canned_response_workspace_id_name_unique")) {
      throw new HTTPException(409, {
        message: "A canned response with this name already exists",
      });
    }
    throw error;
  }
}

export default updateCannedResponse;
