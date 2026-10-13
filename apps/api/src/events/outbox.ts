import type db from "../database";
import { outboxTable } from "../database/schema";
import { EVENT_KEYS } from "./event-keys";

export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DomainEventEnvelope<Payload extends Record<string, unknown>> = {
  id: string;
  kind: string;
  occurredAt: string;
  actor: {
    type: "person" | "automation" | "system" | "api_key";
    id: string | null;
    name: string;
  };
  scope:
    | {
        workspaceId: string;
        organisationId?: string;
        projectId?: string;
      }
    | Record<string, never>;
  payload: Payload;
  causationId: string | null;
  depth: number;
  originAutomationId: string | null;
};

export function eventScope(input: {
  workspaceId: string | null;
  organisationId: string | null;
  projectId: string | null;
}): DomainEventEnvelope<Record<string, unknown>>["scope"] {
  if (input.workspaceId) {
    return {
      workspaceId: input.workspaceId,
      ...(input.organisationId ? { organisationId: input.organisationId } : {}),
      ...(input.projectId ? { projectId: input.projectId } : {}),
    };
  }
  if (input.organisationId || input.projectId) {
    throw new TypeError("An instance event cannot include narrower scope");
  }
  return {};
}

/** Persists the complete events.md envelope inside the mutation's transaction. */
export async function enqueueOutboxEvent<
  Payload extends Record<string, unknown>,
>(tx: DbTransaction, event: DomainEventEnvelope<Payload>): Promise<void> {
  if (!EVENT_KEYS.has(event.kind)) {
    throw new TypeError(`Unknown domain event kind: ${event.kind}`);
  }
  if (!event.scope.workspaceId) {
    const instanceScopedKeys = new Set([
      "pending_action.requested",
      "pending_action.decided",
      "pending_action.executed",
      "identity.deprovisioned",
    ]);
    if (
      Object.keys(event.scope).length > 0 ||
      !instanceScopedKeys.has(event.kind)
    ) {
      throw new TypeError("Event kind does not permit instance scope");
    }
  }

  const workspaceId =
    "workspaceId" in event.scope ? event.scope.workspaceId : null;
  await tx.insert(outboxTable).values({
    eventId: event.id,
    kind: event.kind,
    payload: event,
    dedupeKey: null,
    workspaceId,
    organisationId: event.scope.organisationId ?? null,
    state: "pending",
    attempts: 0,
    lastError: null,
  });
}
