import { evaluateAssigneeEligibility } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import type db from "../database";
import { membershipTable, personTable } from "../database/schema";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

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
  const [roster] = await dbOrTx
    .select({ active: personTable.active })
    .from(membershipTable)
    .innerJoin(personTable, eq(personTable.id, membershipTable.personId))
    .where(
      and(
        eq(membershipTable.scope, "project"),
        eq(membershipTable.scopeId, projectId),
        eq(membershipTable.personId, personId),
      ),
    )
    .limit(1);

  return evaluateAssigneeEligibility({
    onRoster: roster !== undefined,
    active: roster?.active ?? false,
  });
}
