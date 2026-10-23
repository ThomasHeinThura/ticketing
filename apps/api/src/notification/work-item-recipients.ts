import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import { projectAncestryFor } from "../utils/project-ancestry";
import type { NotificationRecipientCandidate } from "./fanout";
import { configuredMentionChannels } from "./fanout.repository";
import { canReadNativeInboxCandidate } from "./native-inbox-reach";
import {
  findCurrentNotificationResource,
  findNotificationPerson,
  findWorkItemAssigneeId,
  listWorkItemWatchers,
} from "./repository";

/**
 * `AS-16` / `AS-17` / `AS-18` / `WI-28`: who is told about an assignment or a state change.
 * The event itself is always emitted (automations, webhooks, activity); this module only
 * decides the notification audience.
 */
export type WorkItemRecipientRole =
  | "assignee"
  | "previous_assignee"
  | "watcher";

export type PlannedWorkItemRecipient = {
  personId: string;
  role: WorkItemRecipientRole;
};

export type WorkItemRecipientPlanInput = {
  kind:
    | "work_item.assigned"
    | "work_item.unassigned"
    | "work_item.transitioned"
    | "work_item.escalated";
  assigneeId: string | null;
  previousAssigneeId: string | null;
  watchers: readonly { personId: string; muted: boolean }[];
  /** The acting person, never notified of their own action (`AS-18`). */
  actorPersonId: string | null;
};

/**
 * Pure audience selection, no I/O:
 * - `assigned` notifies the new assignee (`AS-16`) and, on a reassignment, the previous
 *   holder, who is losing the work (`AS-3`);
 * - `unassigned` notifies the previous assignee (`AS-17`);
 * - unmuted watchers are told about all three (`WI-28`/`WI-29`); a muted watcher row is a
 *   suppression flag for watcher notifications only, so it never silences a direct
 *   assignee/previous-assignee notification;
 * - the actor is removed, whichever role they would have had (`AS-18`, including
 *   unassigning yourself);
 * - one entry per person, the most direct role wins.
 */
export function planWorkItemRecipients(
  input: WorkItemRecipientPlanInput,
): PlannedWorkItemRecipient[] {
  const ordered: PlannedWorkItemRecipient[] = [];
  // `work_item.escalated` (CP-7): the current assignee and unmuted watchers are "the team".
  if (
    (input.kind === "work_item.assigned" ||
      input.kind === "work_item.escalated") &&
    input.assigneeId
  ) {
    ordered.push({ personId: input.assigneeId, role: "assignee" });
  }
  if (
    input.kind !== "work_item.transitioned" &&
    input.previousAssigneeId &&
    input.previousAssigneeId !== input.assigneeId
  ) {
    ordered.push({
      personId: input.previousAssigneeId,
      role: "previous_assignee",
    });
  }
  for (const watcher of input.watchers) {
    if (!watcher.muted) {
      ordered.push({ personId: watcher.personId, role: "watcher" });
    }
  }
  const seen = new Set<string>();
  const planned: PlannedWorkItemRecipient[] = [];
  for (const recipient of ordered) {
    if (recipient.personId === input.actorPersonId) continue;
    if (seen.has(recipient.personId)) continue;
    seen.add(recipient.personId);
    planned.push(recipient);
  }
  return planned;
}

function projection(
  kind: WorkItemRecipientPlanInput["kind"],
  role: WorkItemRecipientRole,
  key: string,
): { title: string; body: string } {
  if (kind === "work_item.escalated")
    return {
      title: "Customer raised the priority",
      body: `The customer raised the priority of ${key}.`,
    };
  if (role === "assignee") {
    return {
      title: "Assigned to you",
      body: `${key} was assigned to you.`,
    };
  }
  if (role === "previous_assignee") {
    return kind === "work_item.unassigned"
      ? { title: "Unassigned", body: `You are no longer assigned to ${key}.` }
      : {
          title: "Reassigned",
          body: `${key} was reassigned and is no longer assigned to you.`,
        };
  }
  if (kind === "work_item.transitioned") {
    return {
      title: "Watched work item changed state",
      body: `${key} changed state.`,
    };
  }
  return {
    title: "Watched work item assignment changed",
    body: `The assignee of ${key} changed.`,
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Resolver for `work_item.assigned` / `work_item.unassigned` / `work_item.transitioned`.
 * Every candidate, watchers included, goes through the same current identity, reach and
 * capability evaluators as the inbox read, so someone who lost access since watching is
 * dropped rather than told. `event.actor.id` is the acting USER id (the convention of the
 * work-item event envelope and of the mention resolver), so the actor is matched by the
 * recipient's linked user as well as by person id.
 */
export async function resolveWorkItemEventRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (
    event.kind !== "work_item.assigned" &&
    event.kind !== "work_item.unassigned" &&
    event.kind !== "work_item.transitioned" &&
    event.kind !== "work_item.escalated"
  )
    return [];
  const workItemId = nullableString(event.payload.workItemId);
  const key = nullableString(event.payload.key);
  if (!workItemId || !key || !("workspaceId" in event.scope)) return [];
  const kind = event.kind;

  const watchers = await listWorkItemWatchers(tx, workItemId);
  const planned = planWorkItemRecipients({
    kind,
    // An escalation payload carries priorities only; the audience is the stored assignee.
    assigneeId:
      kind === "work_item.escalated"
        ? await findWorkItemAssigneeId(tx, workItemId)
        : nullableString(event.payload.assigneeId),
    previousAssigneeId: nullableString(event.payload.previousAssigneeId),
    watchers,
    actorPersonId: null,
  });
  if (planned.length === 0) return [];

  const resource = await findCurrentNotificationResource(tx, {
    resourceType: "work_item",
    resourceId: workItemId,
    eventKind: kind,
    canonicalWorkItem: { id: workItemId, key },
  });
  if (!resource) return [];
  const channels = await configuredMentionChannels(tx);

  const candidates: NotificationRecipientCandidate[] = [];
  for (const recipient of planned) {
    const person = await findNotificationPerson(tx, recipient.personId);
    if (!person?.active || !person.userId) continue;
    if (event.actor.id !== null && event.actor.id === person.userId) continue;
    const identity = await resolveIdentity(
      { userId: person.userId, credential: "session" },
      tx,
    );
    if (!identity || identity.personId !== recipient.personId) continue;
    if (
      !canReadNativeInboxCandidate(
        identity,
        {
          userId: person.userId,
          personId: recipient.personId,
          resourceType: "work_item",
          resourceId: workItemId,
          kind,
        },
        resource,
        await projectAncestryFor(
          tx,
          identity,
          resource.workspaceId,
          resource.projectId ?? "",
        ),
      )
    )
      continue;
    candidates.push({
      personId: recipient.personId,
      resourceType: "work_item",
      resourceId: workItemId,
      ...projection(kind, recipient.role, key),
      channels,
    });
  }
  return candidates;
}
