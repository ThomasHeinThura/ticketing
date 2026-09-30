import type db from "../database";
import { outboxTable } from "../database/schema";
import { EVENT_KEYS } from "./event-keys";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DomainEventEnvelope<Payload extends Record<string, unknown>> = {
  id: string;
  kind: string;
  occurredAt: string;
  actor: {
    type: "person" | "automation" | "system" | "api_key";
    id: string | null;
    name: string;
  };
  scope: {
    workspaceId: string;
    organisationId?: string;
    projectId?: string;
  };
  payload: Payload;
  causationId: string | null;
  depth: number;
  originAutomationId: string | null;
};

/** Persists the complete events.md envelope inside the mutation's transaction. */
export async function enqueueOutboxEvent<
  Payload extends Record<string, unknown>,
>(tx: DbTransaction, event: DomainEventEnvelope<Payload>): Promise<void> {
  if (!EVENT_KEYS.has(event.kind)) {
    throw new TypeError(`Unknown domain event kind: ${event.kind}`);
  }
  if (!event.scope.workspaceId) {
    throw new TypeError("Outbox events require a workspace scope");
  }

  await tx.insert(outboxTable).values({
    eventId: event.id,
    kind: event.kind,
    payload: event,
    dedupeKey: null,
    workspaceId: event.scope.workspaceId,
    organisationId: event.scope.organisationId ?? null,
    state: "pending",
    attempts: 0,
    lastError: null,
  });
}
