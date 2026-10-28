import type { NotificationCopyDescriptorV1 } from "@taskdesk/domain";
import { sql } from "drizzle-orm";
import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
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
  audience: "staff" | "customer" = "staff",
): { title: string; body: string; systemCopy?: NotificationCopyDescriptorV1 } {
  if (audience === "customer")
    return {
      title: "Request updated",
      body: "A request you follow has a new status.",
      systemCopy: {
        version: 1,
        title: [
          { kind: "term", termKey: "request", count: 1 },
          { kind: "text", text: " updated" },
        ],
        body: [
          { kind: "text", text: "A " },
          { kind: "term", termKey: "request", count: 1 },
          { kind: "text", text: " you follow has a new status." },
        ],
      },
    };
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
        await projectOwnerTeamFor(
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
      ...projection(kind, recipient.role, key, identity.side),
      channels,
    });
  }
  return candidates;
}

/** NO-19: watcher, assignee and requester recipients for a live comment. */
export async function resolveCommentEventRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind !== "work_item.commented" || !event.scope.workspaceId)
    return [];
  const commentId = nullableString(event.payload.commentId);
  const workItemId = nullableString(event.payload.workItemId);
  const key = nullableString(event.payload.key);
  if (!commentId || !workItemId || !key) return [];

  const contextResult = await tx.execute(sql`
    SELECT c.id AS "commentId", c.visibility, wi.id AS "workItemId",
           wi.key, wi.workspace_id AS "workspaceId", wi.project_id AS "projectId",
           wi.assignee_id AS "assigneeId", wi.requester_id AS "requesterId"
      FROM comment c
      JOIN work_item wi ON wi.id = c.work_item_id
      JOIN project p ON p.id = wi.project_id
      JOIN workspace w ON w.id = wi.workspace_id
     WHERE c.id = ${commentId} AND c.work_item_id = ${workItemId}
       AND wi.key = ${key} AND wi.workspace_id = ${event.scope.workspaceId}
       AND wi.project_id = ${event.scope.projectId ?? null}
       AND c.deleted_at IS NULL AND c.body IS NOT NULL
       AND wi.deleted_at IS NULL AND wi.archived_at IS NULL
       AND p.deleted_at IS NULL AND w.deleted_at IS NULL
     LIMIT 1
  `);
  const context = contextResult.rows[0] as
    | {
        commentId: string;
        visibility: string;
        workItemId: string;
        key: string;
        workspaceId: string;
        projectId: string;
        assigneeId: string | null;
        requesterId: string | null;
      }
    | undefined;
  if (
    !context ||
    !["public", "internal"].includes(context.visibility) ||
    event.payload.visibility !== context.visibility
  )
    return [];

  const resource = await findCurrentNotificationResource(tx, {
    resourceType: "comment",
    resourceId: context.commentId,
    eventKind: event.kind,
    workspaceId: context.workspaceId,
    canonicalWorkItem: { id: context.workItemId, key: context.key },
  });
  if (
    !resource ||
    resource.workspaceId !== context.workspaceId ||
    resource.projectId !== context.projectId ||
    resource.organisationId !== (event.scope.organisationId ?? null)
  )
    return [];

  const watchers = await listWorkItemWatchers(tx, context.workItemId);
  const recipients = new Set<string>();
  for (const personId of [context.assigneeId, context.requesterId])
    if (personId) recipients.add(personId);
  for (const watcher of watchers)
    if (!watcher.muted) recipients.add(watcher.personId);

  const channels = await configuredMentionChannels(tx);
  const candidates: NotificationRecipientCandidate[] = [];
  for (const personId of recipients) {
    const person = await findNotificationPerson(tx, personId);
    if (!person?.active || !person.userId || person.userId === event.actor.id)
      continue;
    const identity = await resolveIdentity(
      { userId: person.userId, credential: "session" },
      tx,
    );
    if (!identity || identity.personId !== personId) continue;
    const ancestorProjectIds = await projectAncestryFor(
      tx,
      identity,
      resource.workspaceId,
      context.projectId,
    );
    const ownerTeamId = await projectOwnerTeamFor(
      tx,
      identity,
      resource.workspaceId,
      context.projectId,
    );
    if (
      !canReadNativeInboxCandidate(
        identity,
        {
          userId: person.userId,
          personId,
          resourceType: "comment",
          resourceId: context.commentId,
          kind: event.kind,
        },
        resource,
        ancestorProjectIds,
        ownerTeamId,
      )
    )
      continue;
    candidates.push({
      personId,
      resourceType: "comment",
      resourceId: context.commentId,
      ...(identity.side === "customer"
        ? {
            title: "New comment on a request",
            body: "A request you can view has a new comment.",
          }
        : {
            title: "New comment",
            body: "A comment was added to a work item you can reach.",
          }),
      channels,
    });
  }
  return candidates;
}
