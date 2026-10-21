import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, isNull } from "drizzle-orm";
import { executorOrDefault } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import { projectTable } from "../database/schema";

export async function findCapabilityProject(
  identity: ResolvedIdentity,
  workspaceId: string,
  projectId: string,
) {
  const db = executorOrDefault();
  const [project] = await db
    .select({
      projectId: projectTable.id,
      workspaceId: projectTable.workspaceId,
      organisationId: projectTable.organisationId,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        eq(projectTable.workspaceId, workspaceId),
        isNull(projectTable.deletedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          db,
        ),
      ),
    )
    .limit(1);
  return project;
}
