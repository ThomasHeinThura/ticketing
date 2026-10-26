import { and, eq } from "drizzle-orm";
import {
  personTable,
  teamMemberTable,
  teamTable,
  userTable,
} from "../database/schema";
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
} from "./repository";

const EVENT_KIND = "automation.notification_sent";

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The current roster is rechecked at send time as well as when the event is created. */
export async function isActiveTeamNotificationRecipient(
  tx: DbTransaction,
  input: {
    teamId: string;
    workspaceId: string;
    userId: string;
    personId: string;
  },
): Promise<boolean> {
  const [row] = await tx
    .select({ id: teamMemberTable.id })
    .from(teamMemberTable)
    .innerJoin(teamTable, eq(teamTable.id, teamMemberTable.teamId))
    .innerJoin(userTable, eq(userTable.id, teamMemberTable.userId))
    .innerJoin(personTable, eq(personTable.userId, userTable.id))
    .where(
      and(
        eq(teamMemberTable.teamId, input.teamId),
        eq(teamMemberTable.userId, input.userId),
        eq(personTable.id, input.personId),
        eq(personTable.active, true),
        eq(teamTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** TM-9: current active staff team members with current work-item reach only. */
export async function resolveAutomationTeamRecipients(
  tx: DbTransaction,
  event: DomainEventEnvelope<Record<string, unknown>>,
): Promise<readonly NotificationRecipientCandidate[]> {
  if (event.kind !== EVENT_KIND || !("workspaceId" in event.scope)) return [];
  const { teamId, workItemId, key, title, body } = event.payload;
  if (
    !nonEmpty(teamId) ||
    !nonEmpty(workItemId) ||
    !nonEmpty(key) ||
    typeof title !== "string" ||
    typeof body !== "string"
  )
    return [];
  const workspaceId = event.scope.workspaceId;
  const projectId =
    "projectId" in event.scope && nonEmpty(event.scope.projectId)
      ? event.scope.projectId
      : null;
  if (!projectId) return [];
  const resource = await findCurrentNotificationResource(tx, {
    resourceType: "work_item",
    resourceId: workItemId,
    eventKind: EVENT_KIND,
    workspaceId,
    canonicalWorkItem: { id: workItemId, key },
  });
  if (
    !resource ||
    resource.workspaceId !== workspaceId ||
    resource.projectId !== projectId
  )
    return [];

  const members = await tx
    .select({ userId: teamMemberTable.userId, personId: personTable.id })
    .from(teamMemberTable)
    .innerJoin(teamTable, eq(teamTable.id, teamMemberTable.teamId))
    .innerJoin(userTable, eq(userTable.id, teamMemberTable.userId))
    .innerJoin(personTable, eq(personTable.userId, userTable.id))
    .where(
      and(
        eq(teamMemberTable.teamId, teamId),
        eq(teamTable.workspaceId, workspaceId),
        eq(personTable.active, true),
      ),
    );
  const channels = await configuredMentionChannels(tx);
  const candidates: NotificationRecipientCandidate[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const person = await findNotificationPerson(tx, member.personId);
    if (
      !person?.active ||
      !person.userId ||
      person.userId !== member.userId ||
      seen.has(member.personId)
    )
      continue;
    const identity = await resolveIdentity(
      { userId: person.userId, credential: "session" },
      tx,
    );
    if (identity?.side !== "staff" || identity.personId !== member.personId)
      continue;
    if (
      !canReadNativeInboxCandidate(
        identity,
        {
          userId: person.userId,
          personId: member.personId,
          resourceType: "work_item",
          resourceId: workItemId,
          kind: EVENT_KIND,
        },
        resource,
        await projectAncestryFor(tx, identity, workspaceId, projectId),
        await projectOwnerTeamFor(tx, identity, workspaceId, projectId),
      )
    )
      continue;
    seen.add(member.personId);
    candidates.push({
      personId: member.personId,
      resourceType: "work_item",
      resourceId: workItemId,
      title,
      body,
      channels,
    });
  }
  return candidates;
}
