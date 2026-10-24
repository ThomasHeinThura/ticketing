import { appendAuditLog } from "../audit/audit-writer";
import type { Executor } from "../database/executor";

export type PageActor = {
  userId: string;
  personId: string;
  actorType: "person" | "api_key";
  apiKeyId: string | null;
};

type Json = Record<string, unknown>;

/**
 * PG-8: one audit row per page mutation. The page body is never passed in: callers give metadata
 * only (title, version, parent, the version restored), so a body cannot reach the audit trail.
 */
export async function auditPage(
  tx: Executor,
  input: {
    action:
      | "page.created"
      | "page.updated"
      | "page.restored"
      | "page.deleted"
      | "page.undeleted";
    workspaceId: string;
    projectId: string;
    pageId: string;
    actor: PageActor;
    before?: Json | null;
    after?: Json | null;
  },
) {
  await appendAuditLog(tx, {
    actorId: input.actor.userId,
    actorType: input.actor.actorType,
    apiKeyId: input.actor.apiKeyId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    action: input.action,
    entityType: "project_page",
    entityId: input.pageId,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
  });
}
