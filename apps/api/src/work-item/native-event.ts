import { randomUUID } from "node:crypto";
import { eventContext } from "../events";
import {
  type DbTransaction,
  type DomainEventEnvelope,
  enqueueOutboxEvent,
} from "../events/outbox";
import {
  enqueueNotificationEvent,
  type NotificationFanoutHooks,
} from "../notification/fanout";
import { broadcastNativeWorkItemHint } from "../ws";
import type { ActivityActorType } from "./activity";

export type WorkItemEventInput = {
  kind: `work_item.${string}`;
  workItemId: string;
  key: string;
  workspaceId: string;
  /** Current organisation scope, when the caller already resolved it authoritatively. */
  organisationId?: string;
  projectId: string;
  actorId: string | null;
  actorType: ActivityActorType;
  actorName?: string;
  payload: Record<string, unknown>;
  customerVisible: boolean;
  occurredAt?: Date;
  /**
   * When present the event is written through `enqueueNotificationEvent` (one outbox row
   * plus the inbox/delivery fan-out in this same transaction) instead of the bare outbox
   * write. Never both: that would persist the event twice.
   */
  notify?: NotificationFanoutHooks;
};

export async function recordWorkItemEvent(
  tx: DbTransaction,
  input: WorkItemEventInput,
) {
  const occurredAt = input.occurredAt ?? new Date();
  const id = `evt_${randomUUID()}`;
  const envelope: DomainEventEnvelope<Record<string, unknown>> = {
    id,
    kind: input.kind,
    occurredAt: occurredAt.toISOString(),
    actor: {
      type: input.actorType === "api_key" ? "api_key" : input.actorType,
      id: input.actorId,
      name:
        input.actorName ??
        (input.actorType === "api_key" ? "API key actor" : "TaskDesk actor"),
    },
    scope: {
      workspaceId: input.workspaceId,
      ...(input.organisationId ? { organisationId: input.organisationId } : {}),
      projectId: input.projectId,
    },
    payload: input.payload,
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
  if (input.notify) await enqueueNotificationEvent(tx, envelope, input.notify);
  else await enqueueOutboxEvent(tx, envelope);
  const nativeInitiator = eventContext.getStore()?.nativeInitiator;
  return {
    id,
    occurredAt,
    initiator:
      input.actorType === "person" &&
      input.payload.source !== "import" &&
      input.actorId === nativeInitiator?.userId
        ? nativeInitiator
        : undefined,
  };
}

export async function publishWorkItemHint(
  event: {
    id: string;
    occurredAt: Date;
    initiator?: { userId: string; windowId: string };
  },
  input: Pick<
    WorkItemEventInput,
    "kind" | "key" | "projectId" | "customerVisible"
  >,
) {
  await broadcastNativeWorkItemHint({
    projectId: input.projectId,
    topics: [`project:${input.projectId}`, `work_item:${input.key}`],
    eventId: event.id,
    eventType: input.kind,
    at: event.occurredAt.toISOString(),
    key: input.key,
    customerVisible: input.customerVisible,
    initiator: event.initiator,
  });
}

/**
 * Live "order changed" hint for a re-rank (VW-5). No audit/outbox event is invented for a
 * rank: this only publishes the existing key-only `work_item.updated` hint, the way relation
 * changes do, to staff project/work-item topics (never customer-visible). Delivery is
 * best-effort and re-authorised per subscriber by the realtime adapter.
 */
export async function publishRankHint(input: {
  projectId: string;
  key: string;
}) {
  await publishWorkItemHint(
    {
      id: `hint_${randomUUID()}`,
      occurredAt: new Date(),
      initiator: eventContext.getStore()?.nativeInitiator,
    },
    {
      kind: "work_item.updated",
      key: input.key,
      projectId: input.projectId,
      customerVisible: false,
    },
  );
}
