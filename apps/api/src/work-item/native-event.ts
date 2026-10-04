import { randomUUID } from "node:crypto";
import { type DbTransaction, enqueueOutboxEvent } from "../events/outbox";
import { broadcastNativeWorkItemHint } from "../ws";
import type { ActivityActorType } from "./activity";

export type WorkItemEventInput = {
  kind: `work_item.${string}`;
  workItemId: string;
  key: string;
  workspaceId: string;
  projectId: string;
  actorId: string | null;
  actorType: ActivityActorType;
  payload: Record<string, unknown>;
  customerVisible: boolean;
  occurredAt?: Date;
};

export async function recordWorkItemEvent(
  tx: DbTransaction,
  input: WorkItemEventInput,
) {
  const occurredAt = input.occurredAt ?? new Date();
  const id = `evt_${randomUUID()}`;
  await enqueueOutboxEvent(tx, {
    id,
    kind: input.kind,
    occurredAt: occurredAt.toISOString(),
    actor: {
      type: input.actorType === "api_key" ? "api_key" : input.actorType,
      id: input.actorId,
      name: input.actorType === "api_key" ? "API key actor" : "TaskDesk actor",
    },
    scope: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    },
    payload: input.payload,
    causationId: null,
    depth: 0,
    originAutomationId: null,
  });
  return { id, occurredAt };
}

export async function publishWorkItemHint(
  event: { id: string; occurredAt: Date },
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
  });
}
