import { and, count, eq, inArray, isNull, notInArray } from "drizzle-orm";
import type { Executor } from "../database/executor";
import {
  membershipTable,
  personTable,
  projectTable,
  stateTable,
  stateTemplateTable,
  workItemRelationTable,
  workItemTable,
} from "../database/schema";

export type WorkItemRowFactsInput = {
  id: string;
  projectId: string;
  assigneeId: string | null;
};

export type WorkItemRowFacts = {
  /** `person.active` of the assignee; `null` when unassigned. `AS-8`. */
  assigneeActive: boolean | null;
  /** Whether the assignee still holds a project-scoped membership; `null` when unassigned. */
  assigneeOnProject: boolean | null;
  /** Live `blocks` relations pointing at this item whose blocker is not closed. `RH-17`. */
  blockedByOpenCount: number;
};

/**
 * Display facts the list and detail routes attach to their rows, resolved in THREE bounded
 * queries per page (people, project memberships, open blockers) rather than per row, and
 * through `IN` lookups rather than joins, so a row can never be multiplied and pagination
 * never shifts. "Open blocker" is the `hasOpenBlockers` rule (live, un-archived blocker in a
 * project that is not deleted/archived whose mapped `state_template.group` is not
 * completed/cancelled), batched.
 */
export async function loadWorkItemRowFacts(
  executor: Executor,
  items: readonly WorkItemRowFactsInput[],
): Promise<Map<string, WorkItemRowFacts>> {
  const facts = new Map<string, WorkItemRowFacts>();
  if (items.length === 0) return facts;

  const assigneeIds = [
    ...new Set(
      items.flatMap((item) => (item.assigneeId ? [item.assigneeId] : [])),
    ),
  ];
  const projectIds = [...new Set(items.map((item) => item.projectId))];

  const activeByPerson = new Map<string, boolean>();
  const rosterKeys = new Set<string>();
  if (assigneeIds.length > 0) {
    const people = await executor
      .select({ id: personTable.id, active: personTable.active })
      .from(personTable)
      .where(inArray(personTable.id, assigneeIds));
    for (const person of people) activeByPerson.set(person.id, person.active);
    const memberships = await executor
      .select({
        personId: membershipTable.personId,
        projectId: membershipTable.scopeId,
      })
      .from(membershipTable)
      .where(
        and(
          eq(membershipTable.scope, "project"),
          inArray(membershipTable.scopeId, projectIds),
          inArray(membershipTable.personId, assigneeIds),
        ),
      );
    for (const row of memberships) {
      rosterKeys.add(`${row.projectId}\u0000${row.personId}`);
    }
  }

  const blockerRows = await executor
    .select({
      targetId: workItemRelationTable.targetId,
      open: count(),
    })
    .from(workItemRelationTable)
    .innerJoin(
      workItemTable,
      eq(workItemTable.id, workItemRelationTable.sourceId),
    )
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(stateTable, eq(stateTable.id, workItemTable.stateId))
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .where(
      and(
        inArray(
          workItemRelationTable.targetId,
          items.map((item) => item.id),
        ),
        eq(workItemRelationTable.type, "blocks"),
        isNull(workItemTable.deletedAt),
        isNull(workItemTable.archivedAt),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        notInArray(stateTemplateTable.group, ["completed", "cancelled"]),
      ),
    )
    .groupBy(workItemRelationTable.targetId);
  const blockedBy = new Map(blockerRows.map((row) => [row.targetId, row.open]));

  for (const item of items) {
    facts.set(item.id, {
      assigneeActive: item.assigneeId
        ? (activeByPerson.get(item.assigneeId) ?? false)
        : null,
      assigneeOnProject: item.assigneeId
        ? rosterKeys.has(`${item.projectId}\u0000${item.assigneeId}`)
        : null,
      blockedByOpenCount: blockedBy.get(item.id) ?? 0,
    });
  }
  return facts;
}
