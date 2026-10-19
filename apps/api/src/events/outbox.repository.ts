import type { Executor } from "../database/executor";
import { outboxTable } from "../database/schema";
import type { DomainEventEnvelope } from "./outbox";

export async function insertOutboxEvent<
  Payload extends Record<string, unknown>,
>(executor: Executor, event: DomainEventEnvelope<Payload>): Promise<void> {
  const workspaceId =
    "workspaceId" in event.scope ? event.scope.workspaceId : null;
  await executor.insert(outboxTable).values({
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
