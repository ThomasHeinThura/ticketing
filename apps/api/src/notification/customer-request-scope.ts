import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  notExists,
  or,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  commentTable,
  personTable,
  projectTable,
  requestTypeTable,
  submissionTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";

/**
 * A staff-raised item that no submission was ever converted into or merged with. An item linked
 * to a submission keeps the submission rule alone, so moving the submission to another requester
 * still ends the first customer's notifications.
 */
function notLinkedToSubmission(workItemId: SQLWrapper, executor: Executor) {
  const linked = alias(
    submissionTable,
    "notification_direct_linked_submission",
  );
  return notExists(
    executor
      .select({ one: sql`1` })
      .from(linked)
      .where(eq(linked.workItemId, workItemId)),
  );
}

/**
 * U-12 (D6, `CP-16`): a request staff raised for a customer (`direct`) belongs to its requester,
 * on the portal case list's direct-source conditions: the item's requester is this customer-side
 * person of the serving project's organisation, and the item, its live, unarchived project and
 * workspace still exist. Narrower than the list: only items never linked to a submission. Only
 * the requester owns it; a participant or an organisation colleague reads the request but is not
 * told about it, as on the submission side.
 */
function directOwnedRequestExists(
  personId: string,
  workItemId: SQLWrapper,
  executor: Executor,
  identity?: ResolvedIdentity,
) {
  const item = alias(workItemTable, "notification_direct_request_item");
  const requester = alias(personTable, "notification_direct_request_person");
  const project = alias(projectTable, "notification_direct_request_project");
  const workspace = alias(
    workspaceTable,
    "notification_direct_request_workspace",
  );
  return exists(
    executor
      .select({ one: sql`1` })
      .from(item)
      .innerJoin(requester, eq(requester.id, item.requesterId))
      .innerJoin(project, eq(project.id, item.projectId))
      .innerJoin(workspace, eq(workspace.id, item.workspaceId))
      .where(
        and(
          eq(item.id, workItemId),
          eq(item.requesterId, personId),
          eq(requester.side, "customer"),
          eq(requester.organisationId, project.organisationId),
          eq(project.workspaceId, item.workspaceId),
          isNull(item.deletedAt),
          isNull(item.archivedAt),
          isNull(project.deletedAt),
          isNull(project.archivedAt),
          isNull(workspace.deletedAt),
          notLinkedToSubmission(item.id, executor),
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

/** The customer owns the item: through a linked submission, or as a direct request's requester. */
function linkedOwnedRequestExists(
  personId: string,
  workItemId: SQLWrapper,
  executor: Executor,
  identity?: ResolvedIdentity,
) {
  return sql`(${submissionOwnedRequestExists(personId, workItemId, executor, identity)} OR ${directOwnedRequestExists(personId, workItemId, executor, identity)})`;
}

function submissionOwnedRequestExists(
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
  // U-12: a direct request's customer requester owns it too (see `directOwnedRequestExists`).
  const directItem = alias(workItemTable, "notification_direct_owner_item");
  const directRequester = alias(
    personTable,
    "notification_direct_owner_person",
  );
  const directProject = alias(
    projectTable,
    "notification_direct_owner_project",
  );
  const directWorkspace = alias(
    workspaceTable,
    "notification_direct_owner_workspace",
  );
  const directRows = await executor
    .select({ workItemId: directItem.id, personId: directRequester.id })
    .from(directItem)
    .innerJoin(directRequester, eq(directRequester.id, directItem.requesterId))
    .innerJoin(directProject, eq(directProject.id, directItem.projectId))
    .innerJoin(directWorkspace, eq(directWorkspace.id, directItem.workspaceId))
    .where(
      and(
        inArray(directItem.id, [...new Set(workItemIds)]),
        eq(directRequester.side, "customer"),
        eq(directRequester.organisationId, directProject.organisationId),
        eq(directProject.workspaceId, directItem.workspaceId),
        isNull(directItem.deletedAt),
        isNull(directItem.archivedAt),
        isNull(directProject.deletedAt),
        isNull(directProject.archivedAt),
        isNull(directWorkspace.deletedAt),
        notLinkedToSubmission(directItem.id, executor),
      ),
    );
  const owners = new Map<string, string[]>();
  for (const row of [...rows, ...directRows]) {
    const personIds = owners.get(row.workItemId) ?? [];
    if (!personIds.includes(row.personId)) personIds.push(row.personId);
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
