import type db from "../database";
import { currentAutomationContext } from "./automation-context";
import { EVENT_KEYS } from "./event-keys";
import { insertOutboxEvent } from "./outbox.repository";

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

/**
 * `EV-3`: an event written while an automation action is executing carries the chain facts
 * (`depth`, `causationId`, `originAutomationId`), whatever the producer passed. Outside an
 * automation context the envelope is returned untouched.
 */
export function withAutomationContext<Payload extends Record<string, unknown>>(
  event: DomainEventEnvelope<Payload>,
): DomainEventEnvelope<Payload> {
  const context = currentAutomationContext();
  if (!context) return event;
  return {
    ...event,
    // `AM-4`: produced by the rule, attributed to it by id and name.
    actor: {
      type: "automation",
      id: context.automationId,
      name: context.automationName,
    },
    depth: Math.max(event.depth, context.depth),
    causationId: event.causationId ?? context.causationId,
    originAutomationId: event.originAutomationId ?? context.automationId,
  };
}

/** Persists the complete events.md envelope inside the mutation's transaction. */
export async function enqueueOutboxEvent<
  Payload extends Record<string, unknown>,
>(tx: DbTransaction, input: DomainEventEnvelope<Payload>): Promise<void> {
  const event = withAutomationContext(input);
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

  await insertOutboxEvent(tx, event);
}
