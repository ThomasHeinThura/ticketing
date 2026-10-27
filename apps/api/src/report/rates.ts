import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, inArray, isNull } from "drizzle-orm";
import db from "../database";
import { projectTable } from "../database/schema";
import { holdsAtProject } from "../time-tracking/http";

/**
 * TC-11 at project scope for reports (P5-R2-03), the rule the time-tracking routes follow since
 * P5-R1-06: `time_entry:manage_rates` is resolved AT a project, so a project role override that
 * removes it hides that project's rates and costs.
 *
 * - A report filtered to one project: the capability at that project decides (the caller of this
 *   helper checks it); report project filters are exact, never a subtree.
 * - A report across the workspace: rates show only when no project in the workspace has an
 *   override that removes the capability for this caller. Workspace reports aggregate across
 *   projects, so a cost cannot be stripped per project row; this fails closed instead.
 *
 * Returns whether the caller's project overrides allow rates; the workspace (or project) level
 * capability and the cost-tracking flag are checked by the caller as before.
 */
export async function projectOverridesAllowRates(
  identity: ResolvedIdentity,
  workspaceId: string,
  projectId?: string,
): Promise<boolean> {
  if (projectId !== undefined) return true;
  const overridden = [
    ...new Set(
      identity.authority
        .filter((grant) => grant.scope === "project" && grant.scopeId)
        .map((grant) => grant.scopeId as string),
    ),
  ];
  if (overridden.length === 0) return true;
  const projects = await db
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        inArray(projectTable.id, overridden),
        isNull(projectTable.deletedAt),
      ),
    );
  for (const project of projects)
    if (
      !(await holdsAtProject(
        identity,
        "time_entry:manage_rates",
        workspaceId,
        project.id,
      ))
    )
      return false;
  return true;
}
