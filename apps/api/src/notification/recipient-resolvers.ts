import { can, type ProjectReachFacts, reaches } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "../database";
import { workspaceTable } from "../database/schema";
import type { DbTransaction, DomainEventEnvelope } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import type { NotificationRecipientCandidate } from "./fanout";

export type EnabledNotificationChannels = (input: {
  tx: DbTransaction;
  personId: string;
  workspaceId: string;
  eventKind: string;
}) => Promise<readonly string[]>;

/** Current-reach, current-visibility recipient resolver for the AP approval lifecycle. */
export async function resolveApprovalEventRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (!event.kind.startsWith("approval.")) return [];
  const approvalId = event.payload.approvalId;
  if (typeof approvalId !== "string" || !approvalId) return [];
  const [row] = await tx
    .select({
      id: schema.approvalTable.id,
      kind: schema.approvalTable.kind,
      requestedBy: schema.approvalTable.requestedBy,
      approverId: schema.approvalTable.approverId,
      workItemId: schema.workItemTable.id,
      workspaceId: schema.workItemTable.workspaceId,
      projectId: schema.workItemTable.projectId,
      organisationId: schema.workspaceTable.organisationId,
      requesterId: schema.workItemTable.requesterId,
      customerVisibility: schema.workItemTable.customerVisibility,
    })
    .from(schema.approvalTable)
    .innerJoin(
      schema.workItemTable,
      eq(schema.workItemTable.id, schema.approvalTable.workItemId),
    )
    .innerJoin(
      schema.projectTable,
      eq(schema.projectTable.id, schema.workItemTable.projectId),
    )
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.workItemTable.workspaceId),
    )
    .where(
      and(
        eq(schema.approvalTable.id, approvalId),
        isNull(schema.workItemTable.deletedAt),
        isNull(schema.workItemTable.archivedAt),
        isNull(schema.projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (
    !row ||
    !("workspaceId" in event.scope) ||
    event.scope.workspaceId !== row.workspaceId
  )
    return [];

  let personIds: string[];
  switch (event.kind) {
    case "approval.requested":
    case "approval.expiring":
    case "approval.withdrawn":
      personIds = [row.approverId];
      break;
    case "approval.expired":
      personIds = [row.requestedBy];
      break;
    case "approval.decided": {
      const watchers = await tx
        .select({ personId: schema.watcherTable.personId })
        .from(schema.watcherTable)
        .where(eq(schema.watcherTable.workItemId, row.workItemId));
      personIds = [
        row.requestedBy,
        ...watchers.map(({ personId }) => personId),
      ];
      break;
    }
    default:
      return [];
  }

  const visibleToPersonIds =
    row.customerVisibility === "private"
      ? [
          ...(row.requesterId ? [row.requesterId] : []),
          ...(
            await tx
              .select({ personId: schema.requestParticipantTable.personId })
              .from(schema.requestParticipantTable)
              .where(
                eq(schema.requestParticipantTable.workItemId, row.workItemId),
              )
          ).map(({ personId }) => personId),
        ]
      : null;
  const reachFacts: ProjectReachFacts = {
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    organisationId: row.organisationId,
    visibleToPersonIds,
  };
  const candidates: NotificationRecipientCandidate[] = [];
  for (const personId of new Set(personIds)) {
    const [person] = await tx
      .select({
        userId: schema.personTable.userId,
        side: schema.personTable.side,
        active: schema.personTable.active,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, personId))
      .limit(1);
    if (!person?.active || !person.userId) continue;
    // Customers are notified only about approvals directly addressed to or raised by them.
    if (
      person.side === "customer" &&
      personId !== row.approverId &&
      personId !== row.requestedBy
    )
      continue;
    const identity = await resolveIdentity(
      { userId: person.userId, credential: "session" },
      tx,
    );
    if (!identity || !reaches(identity, reachFacts)) continue;
    candidates.push({
      personId,
      resourceType: "approval",
      resourceId: row.id,
      title:
        event.kind === "approval.requested"
          ? "Approval requested"
          : event.kind === "approval.expiring"
            ? "Approval expiring soon"
            : event.kind === "approval.expired"
              ? "Approval expired"
              : event.kind === "approval.withdrawn"
                ? "Approval withdrawn"
                : "Approval decision recorded",
      body:
        event.kind === "approval.requested"
          ? "A work item needs your approval."
          : event.kind === "approval.expiring"
            ? "An approval request is nearing its expiry."
            : event.kind === "approval.expired"
              ? "An approval request has expired."
              : event.kind === "approval.withdrawn"
                ? "An approval request was withdrawn."
                : "An approval request was decided.",
      // External channel adapters and their registry are a separate notifications slice.
      channels: [],
    });
  }
  return candidates;
}

/**
 * Canonical recipient/resource resolver for `workspace.created` (NO-8). The
 * event's owner is a better-auth user id; the notification recipient is the
 * corresponding person id. Current workspace capability is re-evaluated from
 * persisted identity and membership facts in the caller's transaction.
 */
export async function resolveWorkspaceCreatedRecipient(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
  enabledChannels: EnabledNotificationChannels,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind !== "workspace.created") return [];

  const workspaceId = event.payload.workspaceId;
  const ownerUserId = event.payload.ownerId;
  if (
    typeof workspaceId !== "string" ||
    typeof ownerUserId !== "string" ||
    !workspaceId ||
    !ownerUserId ||
    !("workspaceId" in event.scope) ||
    event.scope.workspaceId !== workspaceId
  ) {
    return [];
  }

  const [workspace] = await tx
    .select({ id: workspaceTable.id })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
  if (!workspace) return [];

  const identity = await resolveIdentity(
    { userId: ownerUserId, credential: "session" },
    tx,
  );
  if (
    !identity ||
    !can(identity, "workspace:read", "workspace", { workspaceId })
  ) {
    return [];
  }

  return [
    {
      personId: identity.personId,
      resourceType: "workspace",
      resourceId: workspace.id,
      title: "Workspace created",
      body: "A workspace was created for you.",
      channels: await enabledChannels({
        tx,
        personId: identity.personId,
        workspaceId,
        eventKind: event.kind,
      }),
    },
  ];
}
