import { evaluateAssigneeEligibility } from "@taskdesk/domain";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import type db from "../database";
import { membershipTable, personTable, projectTable } from "../database/schema";
import { loadProjectAncestorIds } from "../project/hierarchy.repository";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * #359: the roster rule shared by the picker (`list-assignable-people.ts`) and the write
 * below, so they cannot disagree. A placeholder can never be assigned and customer-side
 * people hold only organisation memberships, but no constraint enforces either; `active`
 * stays with the callers so the write keeps its distinct `not_active` reason.
 */
export function rosterWhere(projectIds: string[]): SQL {
  return and(
    eq(membershipTable.scope, "project"),
    inArray(membershipTable.scopeId, projectIds),
    eq(personTable.side, "staff"),
    eq(personTable.isPlaceholder, false),
  ) as SQL;
}

/**
 * `AS-5`'s own eligibility rule (project roster, active), shared between the direct
 * `POST /work-items/{key}/assign` route (`controllers/assign-work-item.ts`) and any OTHER
 * write path that turns a stored person id into a live `work_item.assignee_id`.
 *
 * Extracted for `controllers/transition-work-item.ts` (Opus security review of PR #457,
 * finding B2): the transition route's `set_assignee` effect used to write ANY person id
 * straight into `assignee_id` with no roster, active, or tenant check at all -- a
 * deactivated person from a different organisation, off this project's roster entirely,
 * became a work item's assignee via a transition an actor holding only
 * `work_item:transition` (never `work_item:assign`) could trigger. One query, one rule,
 * shared -- not a second, narrower copy of the check `assign-work-item.ts` already has.
 */
export async function resolveAssigneeEligibility(
  dbOrTx: DbOrTx,
  projectId: string,
  personId: string,
): Promise<ReturnType<typeof evaluateAssigneeEligibility>> {
  // PR-2: members of a parent project are members of its children, so the roster is this
  // project plus its ancestors (same workspace, bounded depth).
  const [project] = await dbOrTx
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  const ancestorIds = project
    ? await loadProjectAncestorIds(dbOrTx, project.workspaceId, projectId)
    : [];
  const [roster] = await dbOrTx
    .select({ active: personTable.active })
    .from(membershipTable)
    .innerJoin(personTable, eq(personTable.id, membershipTable.personId))
    .where(
      and(
        rosterWhere([projectId, ...ancestorIds]),
        eq(membershipTable.personId, personId),
      ),
    )
    .limit(1);

  return evaluateAssigneeEligibility({
    onRoster: roster !== undefined,
    active: roster?.active ?? false,
  });
}
