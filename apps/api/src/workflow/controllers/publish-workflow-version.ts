import { HTTPException } from "hono/http-exception";
import type { AppendAuditLogInput } from "../../audit/audit-writer";
import db from "../../database";
import { appendAuditSavepoint } from "../../events/audit-savepoint";
import { notifyCurrentInstanceAdminsOfAuditFailure } from "../../instance/observability/audit-failure-notifier";
import type { ResolveIdentityInput } from "../../permissions/resolve-identity";
import { resolveIdentity } from "../../permissions/resolve-identity";
import {
  findWorkflowVersion,
  findWorkflowWorkspaceId,
  hasCompleteWorkflowProjectReach,
  listVersionTransitions,
  setActiveWorkflowVersion,
  stampVersionPublished,
} from "../repository";

/**
 * Publishes `number` for `workflowId`: stamps `published_at`/`published_by` on that
 * version and sets `workflow.active_version_id` to it (`WF-7`). Immutable once
 * published (`WF-6`): the stamp is written once, and re-publishing a published version is a
 * no-op that returns it unchanged (no stamp overwrite, no silent re-activation).
 */
async function publishWorkflowVersion(
  identityInput: ResolveIdentityInput,
  workflowId: string,
  number: number,
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await db.transaction(
        async (tx) => {
          const identity = await resolveIdentity(identityInput, tx);
          if (!identity) throw new HTTPException(403, { message: "Forbidden" });
          const version = await findWorkflowVersion(
            identity,
            workflowId,
            number,
            tx,
          );
          if (!version) {
            throw new HTTPException(404, {
              message: "Workflow version not found",
            });
          }
          if (
            !(await hasCompleteWorkflowProjectReach(identity, workflowId, tx))
          ) {
            throw new HTTPException(403, {
              message: "Workflow project access required",
            });
          }
          const published = await stampVersionPublished(
            tx,
            version.id,
            identity.personId,
          );
          if (!published)
            throw new HTTPException(404, {
              message: "Workflow version not found",
            });
          // WF-6/WF-7: only a first publication activates. Re-publishing an already published
          // version changes nothing (no stamp overwrite, no silent re-activation): the contract
          // defines no rollback, so a different active version is never displaced by it.
          if (version.publishedAt === null) {
            await setActiveWorkflowVersion(tx, workflowId, version.id);
          }
          const workflow = await findWorkflowWorkspaceId(
            identity,
            workflowId,
            tx,
          );
          if (!workflow)
            throw new HTTPException(404, { message: "Workflow not found" });
          const auditFailed =
            version.publishedAt === null
              ? await appendAuditSavepoint(tx, {
                  ...actor,
                  workspaceId: workflow.workspaceId,
                  action: "workflow.version_published",
                  entityType: "workflow",
                  entityId: workflowId,
                  after: {
                    versionId: version.id,
                    changedFields: ["activeVersion"],
                  },
                })
              : false;
          const transitions = await listVersionTransitions(
            identity,
            version.id,
            tx,
          );
          return { published: { ...published, transitions }, auditFailed };
        },
        { isolationLevel: "serializable" },
      );
      if (result.auditFailed)
        await notifyCurrentInstanceAdminsOfAuditFailure("mutation");
      return result.published;
    } catch (error) {
      let current: unknown = error;
      let serializationFailure = false;
      for (
        let depth = 0;
        depth < 5 && current && typeof current === "object";
        depth += 1
      ) {
        const value = current as { code?: unknown; cause?: unknown };
        if (value.code === "40001") {
          serializationFailure = true;
          break;
        }
        current = value.cause;
      }
      if (!serializationFailure || attempt === 2) throw error;
    }
  }
  throw new Error("Workflow publication transaction exhausted its retries");
}

export default publishWorkflowVersion;
