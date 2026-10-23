import { eq } from "drizzle-orm";
import type db from "../database";
import { projectTable, requestTypeTable } from "../database/schema";
import { resolveAssigneeEligibility } from "../work-item/assignee-eligibility";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DefaultAssigneeResolution =
  | { assigneeId: string }
  | { assigneeId: null; reason: "no_default" | "default_inactive" };

/**
 * Pure rule (`assignment.md` `AS-11`, `AS-12`, and the "default assignee is inactive" edge
 * case). The request type's default overrides the project's. When the chosen default is not
 * eligible the item is left unassigned -- it does NOT fall back to the other default.
 * (`@taskdesk/domain` carries the same rule but does not export it from its barrel, which
 * this lane may not edit; `default-assignee.test.ts` pins this copy.)
 */
export function chooseDefaultAssignee(input: {
  projectDefaultAssigneeId: string | null;
  requestTypeDefaultAssigneeId: string | null;
  isEligible: (personId: string) => boolean;
}): DefaultAssigneeResolution {
  const chosen =
    input.requestTypeDefaultAssigneeId ?? input.projectDefaultAssigneeId;
  if (chosen === null) return { assigneeId: null, reason: "no_default" };
  if (!input.isEligible(chosen)) {
    return { assigneeId: null, reason: "default_inactive" };
  }
  return { assigneeId: chosen };
}

/**
 * The default assignee to apply to a work item created with none, or `null`.
 *
 * Eligibility is the one `AS-5` rule (project roster + active), `resolveAssigneeEligibility`,
 * so a default who has since left the roster or been deactivated is skipped exactly like a
 * direct assignment would be refused.
 *
 * Callers (not wired here: `work-item/**` and `intake/**` belong to other lanes): the
 * work-item create path, and the workflow `set_assignee: "default"` effect, each passing its
 * own transaction.
 */
export async function resolveProjectDefaultAssignee(
  dbOrTx: DbOrTx,
  input: { projectId: string; requestTypeId?: string | null },
): Promise<string | null> {
  const [project] = await dbOrTx
    .select({ defaultAssigneeId: projectTable.defaultAssigneeId })
    .from(projectTable)
    .where(eq(projectTable.id, input.projectId))
    .limit(1);
  if (!project) return null;

  let requestTypeDefault: string | null = null;
  if (input.requestTypeId) {
    const [requestType] = await dbOrTx
      .select({ defaultAssigneeId: requestTypeTable.defaultAssigneeId })
      .from(requestTypeTable)
      .where(eq(requestTypeTable.id, input.requestTypeId))
      .limit(1);
    requestTypeDefault = requestType?.defaultAssigneeId ?? null;
  }

  const chosen = requestTypeDefault ?? project.defaultAssigneeId;
  if (chosen === null) return null;
  const eligibility = await resolveAssigneeEligibility(
    dbOrTx,
    input.projectId,
    chosen,
  );
  return chooseDefaultAssignee({
    projectDefaultAssigneeId: project.defaultAssigneeId,
    requestTypeDefaultAssigneeId: requestTypeDefault,
    isEligible: () => eligibility.eligible,
  }).assigneeId;
}
