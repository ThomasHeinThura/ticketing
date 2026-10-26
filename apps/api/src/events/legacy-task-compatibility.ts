import { randomUUID } from "node:crypto";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import type { LegacyTaskCompatibilityKey } from "./event-keys";
import { type DbTransaction, enqueueOutboxEvent } from "./outbox";

export type LegacyTaskCompatibilityPayload = Record<string, unknown> & {
  /** Legacy task primary key. `key` intentionally remains this opaque legacy id. */
  taskId: string;
  key: string;
  projectId: string;
  url: string;
};

export type LegacyTaskEventActor = {
  type: "person" | "api_key";
  id: string;
  name: string;
};

/** Resolve attribution from canonical identity and authenticated key metadata. */
export function legacyTaskEventActor(
  identity: Pick<ResolvedIdentity, "credential" | "personId">,
  apiKeyId?: string | null,
): LegacyTaskEventActor {
  if (identity.credential === "api_key" || identity.credential === "mcp_key") {
    if (!apiKeyId) {
      throw new TypeError(
        "Legacy task API-key events require the authenticated key id",
      );
    }
    return { type: "api_key", id: apiKeyId, name: "API key actor" };
  }
  if (!identity.personId) {
    throw new TypeError(
      "Legacy task person events require the canonical person id",
    );
  }
  return { type: "person", id: identity.personId, name: "TaskDesk actor" };
}

/**
 * Persist a published legacy task event in the caller's mutation transaction.
 * The compatibility `key` is the actual legacy task id, not a fabricated work-item key.
 * Consumers/configuration remain native-only; these rows exist for durable migration and
 * replay of the published legacy vocabulary.
 */
export async function recordLegacyTaskCompatibilityEvent(
  tx: DbTransaction,
  input: {
    kind: LegacyTaskCompatibilityKey;
    taskId: string;
    projectId: string;
    workspaceId: string;
    identity: Pick<ResolvedIdentity, "credential" | "personId">;
    apiKeyId?: string | null;
    payload?: Record<string, unknown>;
    occurredAt?: Date;
  },
): Promise<string> {
  if (!input.taskId || !input.projectId || !input.workspaceId) {
    throw new TypeError(
      "Legacy task events require task, project, and workspace ids",
    );
  }
  const occurredAt = input.occurredAt ?? new Date();
  const payload: LegacyTaskCompatibilityPayload = {
    ...input.payload,
    taskId: input.taskId,
    key: input.taskId,
    projectId: input.projectId,
    // Keep old task links valid. This route resolves the id to the canonical
    // project-slug/number work-item route; it does not imply an event subscription.
    url: `/dashboard/workspace/${encodeURIComponent(input.workspaceId)}/project/${encodeURIComponent(input.projectId)}/task/${encodeURIComponent(input.taskId)}`,
  };
  const actor = legacyTaskEventActor(input.identity, input.apiKeyId);
  const eventId = `evt_${randomUUID()}`;
  await enqueueOutboxEvent(tx, {
    id: eventId,
    kind: input.kind,
    occurredAt: occurredAt.toISOString(),
    actor,
    scope: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    },
    payload,
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  return eventId;
}
