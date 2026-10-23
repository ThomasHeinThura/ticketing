import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Transaction } from "../database/executor";
import { personTable, projectTable } from "../database/schema";
import type { DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import { projectAncestryFor } from "../utils/project-ancestry";
import type { ActivityActorType } from "../work-item/activity";
import { enqueueNotificationEvent } from "./fanout";
import { canReadNativeInboxCandidate } from "./native-inbox-reach";
import {
  findCurrentNotificationResource,
  findNotificationPerson,
} from "./repository";

export type UnblockedItem = {
  id: string;
  key: string;
  projectId: string;
  workspaceId: string;
  assigneeId: string | null;
};
/** RH-18: one durable event, with a recipient only when its current assignee can read it. */
export async function enqueueWorkItemUnblocked(
  tx: Transaction,
  input: {
    item: UnblockedItem;
    /** Null for a system actor (WF-19 scheduled transition, WF-21 reopen). */
    actorId: string | null;
    actorType: ActivityActorType;
    formerBlockerId: string | null;
  },
) {
  const { item } = input;
  const [project] = await tx
    .select({ organisationId: projectTable.organisationId })
    .from(projectTable)
    .where(eq(projectTable.id, item.projectId));
  const [actorPerson] =
    input.actorType === "person" && input.actorId
      ? await tx
          .select({ id: personTable.id })
          .from(personTable)
          .where(eq(personTable.userId, input.actorId))
          .limit(1)
      : [];
  const event: DomainEventEnvelope<Record<string, unknown>> = {
    id: `evt_${randomUUID()}`,
    kind: "work_item.unblocked",
    occurredAt: new Date().toISOString(),
    actor: {
      id: actorPerson?.id ?? input.actorId,
      type: input.actorType,
      name: "TaskDesk actor",
    },
    scope: {
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      ...(project?.organisationId
        ? { organisationId: project.organisationId }
        : {}),
    },
    payload: {
      workItemId: item.id,
      key: item.key,
      url: `/agent/work-items/${encodeURIComponent(item.key)}`,
      formerBlockerId: input.formerBlockerId,
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
  await enqueueNotificationEvent(tx, event, {
    resolveRecipients: async () => {
      if (!item.assigneeId) return [];
      const person = await findNotificationPerson(tx, item.assigneeId);
      if (!person?.active || !person.userId) return [];
      const identity = await resolveIdentity(
        { userId: person.userId, credential: "session" },
        tx,
      );
      const resource = await findCurrentNotificationResource(tx, {
        resourceType: "work_item",
        resourceId: item.id,
        eventKind: event.kind,
        canonicalWorkItem: { id: item.id, key: item.key },
      });
      if (
        !resource ||
        !canReadNativeInboxCandidate(
          identity,
          {
            userId: person.userId,
            personId: item.assigneeId,
            resourceType: "work_item",
            resourceId: item.id,
            kind: event.kind,
          },
          resource,
          identity
            ? await projectAncestryFor(
                tx,
                identity,
                resource.workspaceId,
                resource.projectId ?? "",
              )
            : undefined,
        )
      )
        return [];
      return [
        {
          personId: item.assigneeId,
          resourceType: "work_item",
          resourceId: item.id,
          title: "Work item unblocked",
          body: `${item.key} has no remaining open blockers.`,
          channels: [],
        },
      ];
    },
  });
  return { id: event.id, occurredAt: new Date(event.occurredAt) };
}
