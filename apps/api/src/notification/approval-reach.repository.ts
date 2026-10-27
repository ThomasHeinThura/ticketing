import { and, eq, exists, isNull, ne, or } from "drizzle-orm";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";
import { notificationTable, projectTable } from "../database/schema";
import { projectReachPredicate } from "./task-reach.repository";

/**
 * Current-reach read predicate for inbox rows with `resource_type = 'approval'` (pre-wiring
 * gate: every registered fan-out resource type needs its own read predicate). An approval
 * row is readable only while the approval still exists inside its workspace (0120 anchor,
 * joined on `(workspace_id, work_item_id)`), its work item and project are live, the row's
 * recipient is the approval's requester or approver (or a watcher of the work item), a
 * private item is visible to that person, and the user still has staff project reach. A
 * customer row (AP-21, `P2R1-04`) is readable only by the active customer who is the addressed
 * approver of a `customer` approval on a project serving their own organisation. Anything else
 * fails closed.
 */
function reachableApprovalNotificationPredicate(
  userId: string,
  executor: Executor,
) {
  const person = schema.personTable;
  return exists(
    executor
      .select({ id: schema.approvalTable.id })
      .from(schema.approvalTable)
      .innerJoin(
        schema.workItemTable,
        and(
          eq(schema.workItemTable.id, schema.approvalTable.workItemId),
          eq(
            schema.workItemTable.workspaceId,
            schema.approvalTable.workspaceId,
          ),
        ),
      )
      .innerJoin(
        projectTable,
        eq(projectTable.id, schema.workItemTable.projectId),
      )
      .where(
        and(
          eq(schema.approvalTable.id, notificationTable.resourceId),
          isNull(schema.workItemTable.deletedAt),
          isNull(schema.workItemTable.archivedAt),
          isNull(projectTable.deletedAt),
          or(
            eq(schema.approvalTable.approverId, notificationTable.personId),
            eq(schema.approvalTable.requestedBy, notificationTable.personId),
            exists(
              executor
                .select({ id: schema.watcherTable.personId })
                .from(schema.watcherTable)
                .where(
                  and(
                    eq(schema.watcherTable.workItemId, schema.workItemTable.id),
                    eq(
                      schema.watcherTable.personId,
                      notificationTable.personId,
                    ),
                  ),
                ),
            ),
          ),
          or(
            ne(schema.workItemTable.customerVisibility, "private"),
            eq(schema.workItemTable.requesterId, notificationTable.personId),
            exists(
              executor
                .select({ id: schema.requestParticipantTable.personId })
                .from(schema.requestParticipantTable)
                .where(
                  and(
                    eq(
                      schema.requestParticipantTable.workItemId,
                      schema.workItemTable.id,
                    ),
                    eq(
                      schema.requestParticipantTable.personId,
                      notificationTable.personId,
                    ),
                  ),
                ),
            ),
          ),
          or(
            and(
              exists(
                executor
                  .select({ id: person.id })
                  .from(person)
                  .where(
                    and(
                      eq(person.id, notificationTable.personId),
                      eq(person.userId, userId),
                      eq(person.active, true),
                      eq(person.side, "staff"),
                    ),
                  ),
              ),
              projectReachPredicate(userId, executor),
            ),
            and(
              eq(schema.approvalTable.kind, "customer"),
              eq(schema.approvalTable.approverId, notificationTable.personId),
              exists(
                executor
                  .select({ id: person.id })
                  .from(person)
                  .where(
                    and(
                      eq(person.id, notificationTable.personId),
                      eq(person.userId, userId),
                      eq(person.active, true),
                      eq(person.side, "customer"),
                      eq(person.organisationId, projectTable.organisationId),
                    ),
                  ),
              ),
            ),
          ),
        ),
      ),
  );
}

/** Rows of any other type pass; `approval` rows need current reach. Used by every inbox read path. */
export function approvalNotificationReadable(
  userId: string,
  executor: Executor = db,
) {
  return or(
    isNull(notificationTable.resourceType),
    ne(notificationTable.resourceType, "approval"),
    reachableApprovalNotificationPredicate(userId, executor),
  );
}
