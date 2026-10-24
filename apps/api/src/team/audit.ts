import { AUDIT_ONLY_ACTIONS } from "../audit/actions";
import { appendAuditLog } from "../audit/audit-writer";
import type { Executor } from "../database/executor";
import { EVENT_KEYS } from "../events/event-keys";

export type GovernanceActor = {
  userId: string;
  actorType: "person" | "api_key";
  apiKeyId?: string | null;
};

/**
 * Audit only when the action is in the closed catalogue. `custom_field.*` actions are added by the
 * coordinator (they live in `audit/actions.ts`); until then the write is skipped rather than
 * failing the mutation with the writer's unknown-action programmer error.
 */
export async function auditIfRegistered(
  tx: Executor,
  input: {
    action: string;
    workspaceId: string;
    entityType: string;
    entityId: string;
    actor: GovernanceActor;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
) {
  if (
    !AUDIT_ONLY_ACTIONS.has(input.action) &&
    !(EVENT_KEYS as ReadonlySet<string>).has(input.action)
  )
    return;
  await appendAuditLog(tx, {
    actorId: input.actor.userId,
    actorType: input.actor.actorType,
    apiKeyId: input.actor.apiKeyId ?? null,
    workspaceId: input.workspaceId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
  });
}
