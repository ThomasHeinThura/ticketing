import { type ProjectReachFacts, reaches } from "@taskdesk/permissions";
import type { DbTransaction } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";
import {
  findWorkItemMentionContextQuery,
  listWorkItemMentionParticipantIdsQuery,
  listWorkItemMentionPeopleQuery,
  type WorkItemMentionContext,
  type WorkItemMentionPersonRow,
} from "./repository";

export type { WorkItemMentionContext } from "./repository";

export type MentionCandidate = {
  personId: string;
  userId: string;
  name: string;
  image: string | null;
  side: "staff" | "customer";
  reachable: boolean;
};

export async function findWorkItemMentionContext(
  executor: DbTransaction,
  workItemId: string,
): Promise<WorkItemMentionContext | null> {
  return findWorkItemMentionContextQuery(executor, workItemId);
}

export async function classifyWorkItemMentionPeople(
  tx: DbTransaction,
  context: WorkItemMentionContext,
  personIds: readonly string[] | undefined,
  visibility: "public" | "internal",
  options: { includeUnreachableCustomers?: boolean } = {},
): Promise<MentionCandidate[]> {
  const uniqueIds = personIds ? [...new Set(personIds)] : undefined;
  if (uniqueIds?.length === 0) return [];

  const participantIds =
    context.customerVisibility === "private"
      ? await listWorkItemMentionParticipantIdsQuery(tx, context.id)
      : [];
  const privateCustomerIds = [
    ...(context.requesterId ? [context.requesterId] : []),
    ...participantIds.map(({ personId }) => personId),
  ];
  const rows: WorkItemMentionPersonRow[] = await listWorkItemMentionPeopleQuery(
    tx,
    context,
    {
      personIds: uniqueIds,
      visibility,
      includeUnreachableCustomers: options.includeUnreachableCustomers,
      privateCustomerIds,
    },
  );
  const reachFacts: ProjectReachFacts = {
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    organisationId: context.organisationId,
    visibleToPersonIds:
      context.customerVisibility === "private"
        ? [
            ...(context.requesterId ? [context.requesterId] : []),
            ...participantIds.map(({ personId }) => personId),
          ]
        : null,
  };
  const result: MentionCandidate[] = [];
  for (const row of rows) {
    if (!row.userId || (row.side !== "staff" && row.side !== "customer"))
      continue;
    const identity = await resolveIdentity(
      { userId: row.userId, credential: "session" },
      tx,
    );
    if (!identity || identity.personId !== row.personId) continue;
    const reachable = reaches(identity, {
      ...reachFacts,
      // `customer_visibility` constrains customer organisation reach. It does not
      // restrict staff with canonical project reach (CP-16 / RBAC § Reach).
      visibleToPersonIds:
        identity.side === "customer" ? reachFacts.visibleToPersonIds : null,
    });
    if (row.side === "customer" && !reachable) continue;
    result.push({
      personId: row.personId,
      userId: row.userId,
      name: row.name || row.email || row.personId,
      image: row.image,
      side: row.side,
      reachable,
    });
  }
  return result;
}
