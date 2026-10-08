import { type ProjectReachFacts, reaches } from "@taskdesk/permissions";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type db from "../database";
import {
  personTable,
  projectTable,
  requestParticipantTable,
  userTable,
  workItemTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import type { DbTransaction } from "../events/outbox";
import { resolveIdentity } from "../permissions/resolve-identity";

type Executor = typeof db | DbTransaction;

export type WorkItemMentionContext = {
  id: string;
  key: string;
  workspaceId: string;
  projectId: string;
  organisationId: string | null;
  customerVisibility: string;
  requesterId: string | null;
};

export type MentionCandidate = {
  personId: string;
  userId: string;
  name: string;
  image: string | null;
  side: "staff" | "customer";
  reachable: boolean;
};

type MentionPersonRow = {
  personId: string;
  userId: string | null;
  side: string;
  name: string | null;
  email: string;
  image: string | null;
};

export async function findWorkItemMentionContext(
  executor: Executor,
  workItemId: string,
): Promise<WorkItemMentionContext | null> {
  const [row] = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      organisationId: workspaceTable.organisationId,
      customerVisibility: workItemTable.customerVisibility,
      requesterId: workItemTable.requesterId,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(workspaceTable, eq(workspaceTable.id, workItemTable.workspaceId))
    .where(
      and(
        eq(workItemTable.id, workItemId),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        isNull(workspaceTable.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function mentionPeopleQuery(
  tx: DbTransaction,
  context: WorkItemMentionContext,
  personIds?: readonly string[],
  visibility: "public" | "internal" = "public",
  includeUnreachableCustomers = false,
): Promise<MentionPersonRow[]> {
  const requestParticipants =
    context.customerVisibility === "private"
      ? await tx
          .select({ personId: requestParticipantTable.personId })
          .from(requestParticipantTable)
          .where(eq(requestParticipantTable.workItemId, context.id))
      : [];
  const privateCustomerIds = [
    ...(context.requesterId ? [context.requesterId] : []),
    ...requestParticipants.map(({ personId }) => personId),
  ];

  const staffScope = and(
    eq(personTable.side, "staff"),
    eq(workspaceUserTable.workspaceId, context.workspaceId),
  );
  const customerScope =
    visibility === "public" &&
    context.organisationId !== null &&
    (context.customerVisibility !== "private" || includeUnreachableCustomers)
      ? and(
          eq(personTable.side, "customer"),
          eq(personTable.organisationId, context.organisationId),
          ...(context.customerVisibility === "private" &&
          !includeUnreachableCustomers
            ? [inArray(personTable.id, privateCustomerIds)]
            : []),
        )
      : undefined;

  const scope = customerScope ? or(staffScope, customerScope) : staffScope;
  const predicates = [
    scope,
    eq(personTable.active, true),
    eq(personTable.isPlaceholder, false),
    eq(userTable.banned, false),
  ];
  if (personIds) predicates.push(inArray(personTable.id, [...personIds]));

  const rows = await tx
    .select({
      personId: personTable.id,
      userId: personTable.userId,
      side: personTable.side,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
    })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, context.workspaceId),
      ),
    )
    .where(and(...predicates));
  return rows;
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

  const rows = await mentionPeopleQuery(
    tx,
    context,
    uniqueIds,
    visibility,
    options.includeUnreachableCustomers,
  );
  const participantIds =
    context.customerVisibility === "private"
      ? await tx
          .select({ personId: requestParticipantTable.personId })
          .from(requestParticipantTable)
          .where(eq(requestParticipantTable.workItemId, context.id))
      : [];
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
    const reachable = reaches(identity, reachFacts);
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
