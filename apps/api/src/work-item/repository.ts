import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  type SQL,
} from "drizzle-orm";
import type db from "../database";
import {
  commentTable,
  commentVersionTable,
  personTable,
  projectTable,
  requestParticipantTable,
  slaPolicyTable,
  slaPolicyVersionTable,
  userTable,
  workItemTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

type Executor =
  | Pick<typeof db, "select">
  | Pick<Parameters<Parameters<typeof db.transaction>[0]>[0], "select">;

export type WorkItemMentionContext = {
  id: string;
  key: string;
  workspaceId: string;
  projectId: string;
  organisationId: string | null;
  customerVisibility: string;
  requesterId: string | null;
};

export type WorkItemMentionPersonRow = {
  personId: string;
  userId: string | null;
  side: string;
  name: string | null;
  email: string;
  image: string | null;
};

export async function findLiveCommentVersionParentQuery(
  executor: Executor,
  commentId: string,
  workItemId: string,
) {
  // The history reader keeps this share lock until its page query finishes. Comment
  // tombstoning takes FOR UPDATE on the same row, so either the read linearizes first
  // with the retained versions or a committed tombstone is observed as absent.
  return executor
    .select({ id: commentTable.id })
    .from(commentTable)
    .where(
      and(
        eq(commentTable.id, commentId),
        eq(commentTable.workItemId, workItemId),
        isNull(commentTable.deletedAt),
      ),
    )
    .limit(1)
    .for("share");
}

export async function listCommentVersionPageQuery(
  executor: Executor,
  commentId: string,
  after: { number: number; id: string } | undefined,
  limit: number,
) {
  const conditions: SQL[] = [eq(commentVersionTable.commentId, commentId)];
  if (after) {
    const continuation = or(
      gt(commentVersionTable.number, after.number),
      and(
        eq(commentVersionTable.number, after.number),
        gt(commentVersionTable.id, after.id),
      ),
    );
    if (continuation) conditions.push(continuation);
  }
  return executor
    .select({
      id: commentVersionTable.id,
      number: commentVersionTable.number,
      body: commentVersionTable.body,
      editedBy: commentVersionTable.editedBy,
      createdAt: commentVersionTable.createdAt,
    })
    .from(commentVersionTable)
    .where(and(...conditions))
    .orderBy(asc(commentVersionTable.number), asc(commentVersionTable.id))
    .limit(limit);
}

export async function findWorkItemMentionContextQuery(
  executor: Executor,
  workItemId: string,
): Promise<WorkItemMentionContext | null> {
  const [row] = await executor
    .select({
      id: workItemTable.id,
      key: workItemTable.key,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      organisationId: projectTable.organisationId,
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

export async function listWorkItemMentionParticipantIdsQuery(
  executor: Executor,
  workItemId: string,
) {
  return executor
    .select({ personId: requestParticipantTable.personId })
    .from(requestParticipantTable)
    .where(eq(requestParticipantTable.workItemId, workItemId));
}

export async function listWorkItemMentionPeopleQuery(
  executor: Executor,
  context: WorkItemMentionContext,
  options: {
    personIds?: readonly string[];
    visibility: "public" | "internal";
    includeUnreachableCustomers?: boolean;
    privateCustomerIds: readonly string[];
  },
): Promise<WorkItemMentionPersonRow[]> {
  const staffScope = and(
    eq(personTable.side, "staff"),
    eq(workspaceUserTable.workspaceId, context.workspaceId),
  );
  const customerScope =
    options.visibility === "public" &&
    context.organisationId !== null &&
    (context.customerVisibility !== "private" ||
      options.includeUnreachableCustomers ||
      options.privateCustomerIds.length > 0)
      ? and(
          eq(personTable.side, "customer"),
          eq(personTable.organisationId, context.organisationId),
          ...(context.customerVisibility === "private" &&
          !options.includeUnreachableCustomers
            ? [inArray(personTable.id, [...options.privateCustomerIds])]
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
  if (options.personIds)
    predicates.push(inArray(personTable.id, [...options.personIds]));
  return executor
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
}

// SLA lookups used by intake conversion (selected #598 source, PR #664).
export async function findWorkspaceDefaultSlaPolicyQuery(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({ slaPolicyId: workspaceTable.defaultSlaPolicyId })
    .from(workspaceTable)
    .where(eq(workspaceTable.id, workspaceId))
    .limit(1);
}

export async function findWorkspaceOwnedSlaPolicyQuery(
  executor: Executor,
  policyId: string,
  workspaceId: string,
) {
  return executor
    .select({ id: slaPolicyTable.id })
    .from(slaPolicyTable)
    .where(
      and(
        eq(slaPolicyTable.id, policyId),
        eq(slaPolicyTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);
}

export async function findEffectiveSlaPolicyVersionQuery(
  executor: Executor,
  workspaceId: string,
  policyId: string,
  slaStartedAt: Date,
) {
  return executor
    .select({ id: slaPolicyVersionTable.id })
    .from(slaPolicyVersionTable)
    .where(
      and(
        eq(slaPolicyVersionTable.workspaceId, workspaceId),
        eq(slaPolicyVersionTable.policyId, policyId),
        isNotNull(slaPolicyVersionTable.effectiveFrom),
        lte(slaPolicyVersionTable.effectiveFrom, slaStartedAt),
      ),
    )
    .orderBy(
      desc(slaPolicyVersionTable.effectiveFrom),
      desc(slaPolicyVersionTable.number),
    )
    .limit(1);
}
