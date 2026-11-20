import type { AppendAuditLogInput } from "../../audit/audit-writer";
import db from "../../database";
import { appendAuditSavepoint } from "../../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import { insertWorkflow } from "../repository";

/** Thrown when `(workspaceId, key)` collides with an existing workflow -- see `workflow_workspace_key_unique`. */
export class WorkflowKeyTakenError extends Error {
  constructor(public readonly key: string) {
    super(`Workflow key "${key}" is already taken in this workspace`);
    this.name = "WorkflowKeyTakenError";
  }
}

async function createWorkflow(
  workspaceId: string,
  key: string,
  name: string,
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
      const created = await insertWorkflow({ workspaceId, key, name }, tx);
      if (!created) throw new Error("Failed to create workflow");
      const auditFailed = await appendAuditSavepoint(tx, {
        ...actor,
        workspaceId,
        action: "workflow.created",
        entityType: "workflow",
        entityId: created.id,
        after: { changedFields: ["definition"] },
      });
      return { created, auditFailed };
    });
    if (result.auditFailed)
      await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
    return result.created;
  } catch (error) {
    if (isUniqueViolation(error, "workflow_workspace_key_unique")) {
      throw new WorkflowKeyTakenError(key);
    }
    throw error;
  }
}

export default createWorkflow;
