import { can } from "@taskdesk/permissions";
import { eq } from "drizzle-orm";
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
