import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  commentTable,
  projectTable,
  requestTypeTable,
  submissionTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";

function linkedOwnedRequestExists(
  personId: string,
  workItemId: SQLWrapper,
  executor: Executor,
  identity?: ResolvedIdentity,
) {
  const item = alias(workItemTable, "notification_owned_request_item");
  const submission = alias(
    submissionTable,
    "notification_owned_request_submission",
  );
  const requestType = alias(
    requestTypeTable,
    "notification_owned_request_type",
  );
  const project = alias(projectTable, "notification_owned_request_project");
  const workspace = alias(
    workspaceTable,
    "notification_owned_request_workspace",
  );
  return exists(
    executor
      .select({ one: sql`1` })
      .from(submission)
      .innerJoin(item, eq(submission.workItemId, item.id))
      .innerJoin(requestType, eq(requestType.id, submission.requestTypeId))
      .innerJoin(project, eq(project.id, item.projectId))
      .innerJoin(workspace, eq(workspace.id, item.workspaceId))
      .where(
        and(
          eq(item.id, workItemId),
          eq(submission.requesterId, personId),
          eq(item.requesterId, personId),
          eq(requestType.workspaceId, item.workspaceId),
          eq(project.workspaceId, item.workspaceId),
          eq(submission.organisationId, project.organisationId),
          isNull(item.deletedAt),
          isNull(item.archivedAt),
          isNull(project.deletedAt),
          isNull(workspace.deletedAt),
          identity
            ? currentProjectReachPredicate(
                identity,
                project.id,
                project.workspaceId,
                project.organisationId,
                executor,
              )
            : undefined,
        ),
      ),
  );
}

function ownedSubmissionExists(
  identity: ResolvedIdentity,
  submissionId: SQLWrapper,
  executor: Executor,
) {
  const submission = alias(submissionTable, "notification_owned_submission");
  const requestType = alias(
    requestTypeTable,
    "notification_owned_submission_type",
  );
  const workspace = alias(
    workspaceTable,
    "notification_owned_submission_workspace",
  );
  const item = alias(workItemTable, "notification_owned_submission_item");
  const project = alias(projectTable, "notification_owned_submission_project");
  const linkedItem = exists(
    executor
      .select({ one: sql`1` })
      .from(item)
      .innerJoin(project, eq(project.id, item.projectId))
      .innerJoin(workspace, eq(workspace.id, item.workspaceId))
      .where(
        and(
          eq(item.id, submission.workItemId),
          eq(item.requesterId, identity.personId),
          eq(item.workspaceId, requestType.workspaceId),
          eq(project.workspaceId, item.workspaceId),
          eq(project.organisationId, submission.organisationId),
          isNull(item.deletedAt),
          isNull(item.archivedAt),
          isNull(project.deletedAt),
          isNull(workspace.deletedAt),
          currentProjectReachPredicate(
            identity,
            project.id,
            project.workspaceId,
            project.organisationId,
            executor,
          ),
        ),
      ),
  );
  return exists(
    executor
      .select({ one: sql`1` })
      .from(submission)
      .innerJoin(requestType, eq(requestType.id, submission.requestTypeId))
      .innerJoin(workspace, eq(workspace.id, requestType.workspaceId))
      .where(
        and(
          eq(submission.id, submissionId),
          eq(submission.requesterId, identity.personId),
          eq(submission.organisationId, identity.organisationId),
          eq(workspace.organisationId, submission.organisationId),
          eq(requestType.customerVisible, true),
          isNull(workspace.deletedAt),
          or(isNull(submission.workItemId), linkedItem),
        ),
      ),
  );
}

/**
 * Customer-native work-item and comment notifications must belong to a still-linked
 * submission requested by the same customer. This SQL predicate is applied before inbox
 * pagination/counting and again on mutation guards.
 */
export function customerOwnedRequestNotificationPredicate(
  identity: ResolvedIdentity,
  resourceType: SQLWrapper,
  resourceId: SQLWrapper,
  executor: Executor,
) {
  if (identity.side !== "customer") return undefined;
  const comment = alias(commentTable, "notification_owned_request_comment");
  return or(
    // AP-21 (`P2R1-04`): a customer approver's approval row; its own read predicate
    // (`approvalNotificationReadable`) admits only the addressed approver of a reachable
    // customer approval.
    eq(resourceType, "approval"),
    and(
      eq(resourceType, "submission"),
      ownedSubmissionExists(identity, resourceId, executor),
    ),
    and(
      eq(resourceType, "work_item"),
      linkedOwnedRequestExists(
        identity.personId,
        resourceId,
        executor,
        identity,
      ),
    ),
    and(
      eq(resourceType, "comment"),
      exists(
        executor
          .select({ one: sql`1` })
          .from(comment)
          .where(
            and(
              eq(comment.id, resourceId),
              isNull(comment.deletedAt),
              isNotNull(comment.body),
              linkedOwnedRequestExists(
                identity.personId,
                comment.workItemId,
                executor,
                identity,
              ),
            ),
          ),
      ),
    ),
  );
}

/** Current linked requester ids for resource projections used by fanout/read predicates. */
export async function findLinkedRequestOwnerPersonIds(
  executor: Executor,
  workItemIds: readonly string[],
): Promise<Map<string, readonly string[]>> {
  if (workItemIds.length === 0) return new Map();
  const item = alias(workItemTable, "notification_request_owner_item");
  const submission = alias(
    submissionTable,
    "notification_request_owner_submission",
  );
  const requestType = alias(
    requestTypeTable,
    "notification_request_owner_type",
  );
  const project = alias(projectTable, "notification_request_owner_project");
  const workspace = alias(
    workspaceTable,
    "notification_request_owner_workspace",
  );
  const rows = await executor
    .select({ workItemId: item.id, personId: submission.requesterId })
    .from(submission)
    .innerJoin(item, eq(submission.workItemId, item.id))
    .innerJoin(requestType, eq(requestType.id, submission.requestTypeId))
    .innerJoin(project, eq(project.id, item.projectId))
    .innerJoin(workspace, eq(workspace.id, item.workspaceId))
    .where(
      and(
        inArray(item.id, [...new Set(workItemIds)]),
        eq(item.requesterId, submission.requesterId),
        eq(requestType.workspaceId, item.workspaceId),
        eq(project.workspaceId, item.workspaceId),
        eq(submission.organisationId, project.organisationId),
        isNull(item.deletedAt),
        isNull(item.archivedAt),
        isNull(project.deletedAt),
        isNull(workspace.deletedAt),
      ),
    );
  const owners = new Map<string, string[]>();
  for (const row of rows) {
    const personIds = owners.get(row.workItemId) ?? [];
    personIds.push(row.personId);
    owners.set(row.workItemId, personIds);
  }
  return owners;
}

export async function isCurrentCustomerOwnRequest(
  executor: Executor,
  identity: ResolvedIdentity,
  workItemId: string,
): Promise<boolean> {
  if (identity.side !== "customer") return false;
  const item = alias(workItemTable, "notification_current_owned_request_item");
  const owned = linkedOwnedRequestExists(
    identity.personId,
    item.id,
    executor,
    identity,
  );
  const [row] = await executor
    .select({ owned })
    .from(item)
    .where(eq(item.id, workItemId))
    .limit(1);
  return row?.owned === true;
}
