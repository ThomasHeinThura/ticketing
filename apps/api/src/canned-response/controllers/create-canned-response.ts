import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import type { AppendAuditLogInput } from "../../audit/audit-writer";
import db from "../../database";
import { appendAuditSavepoint } from "../../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { insertCannedResponse } from "../repository";

export type CreateCannedResponseInput = {
  workspaceId: string;
  name: string;
  body: unknown;
  visibilityDefault?: "public" | "internal";
  createdBy: string;
};

/**
 * `POST /api/canned-responses` (`CA-19`). `canned_response_workspace_id_name_unique`
 * (migration 0074) backs the name uniqueness within a workspace; a collision is answered
 * as a clean 409 rather than the raw constraint-violation 500, matching this codebase's
 * own convention (`create-work-item.ts`'s `work_item_key_claim_pkey` handling).
 */
export async function createCannedResponse(
  identity: ResolvedIdentity,
  input: CreateCannedResponseInput,
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
  try {
    const result = await db.transaction(async (tx) => {
      const created = await insertCannedResponse(
        identity,
        {
          workspaceId: input.workspaceId,
          name: input.name,
          body: input.body,
          visibilityDefault: input.visibilityDefault ?? "internal",
          createdBy: input.createdBy,
        },
        tx,
      );
      if (!created)
        throw new HTTPException(500, {
          message: "Failed to create canned response",
        });
      const auditFailed = await appendAuditSavepoint(tx, {
        ...actor,
        workspaceId: input.workspaceId,
        action: "canned_response.created",
        entityType: "canned_response",
        entityId: created.id,
        after: { changedFields: ["name", "body", "visibilityDefault"] },
      });
      return { created, auditFailed };
    });
    if (result.auditFailed)
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    return result.created;
  } catch (error) {
    if (isUniqueViolation(error, "canned_response_workspace_id_name_unique")) {
      throw new HTTPException(409, {
        message: "A canned response with this name already exists",
      });
    }
    throw error;
  }
}

export default createCannedResponse;
