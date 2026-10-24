import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import db from "../database";
import { projectTable } from "../database/schema";
import { projectPageTable } from "../database/schema-p5-pages";
import { escapeLikePattern } from "../search/like-pattern";
import { snippetOf } from "./logic";

/**
 * PG-6: pages as their own canonical-search entity type. The caller passes the projects they
 * already reach (the same reach set every other entity uses); a hidden project's pages can never
 * be selected, ranked or counted. Soft-deleted pages and pages of deleted or archived projects
 * are excluded in SQL. Only the agent search route calls this: no portal or deflection query
 * reads these tables.
 */
export async function searchProjectPages(params: {
  workspaceId: string;
  reachableProjectIds: string[];
  projectId?: string;
  term: string;
  limit: number;
}) {
  if (params.reachableProjectIds.length === 0) return [];
  const lower = params.term.toLowerCase();
  const prefix = `${escapeLikePattern(lower)}%`;
  const contains = `%${escapeLikePattern(lower)}%`;
  const relevance = sql<number>`
    CASE
      WHEN lower(${projectPageTable.title}) = ${lower} THEN 10
      WHEN lower(${projectPageTable.title}) LIKE ${prefix} THEN 8
      WHEN lower(${projectPageTable.title}) LIKE ${contains} THEN 6
      ELSE 2
    END`;
  const rows = await db
    .select({
      id: projectPageTable.id,
      title: projectPageTable.title,
      bodyText: projectPageTable.bodyText,
      projectId: projectPageTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceId: projectPageTable.workspaceId,
      createdAt: projectPageTable.createdAt,
      relevanceScore: relevance.as("relevance"),
    })
    .from(projectPageTable)
    .innerJoin(projectTable, eq(projectTable.id, projectPageTable.projectId))
    .where(
      and(
        eq(projectPageTable.workspaceId, params.workspaceId),
        isNull(projectPageTable.deletedAt),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        inArray(projectPageTable.projectId, params.reachableProjectIds),
        params.projectId
          ? eq(projectPageTable.projectId, params.projectId)
          : undefined,
        sql`(lower(${projectPageTable.title}) LIKE ${contains} OR lower(${projectPageTable.bodyText}) LIKE ${contains})`,
      ),
    )
    .orderBy(desc(sql`relevance`), desc(projectPageTable.updatedAt))
    .limit(params.limit);
  return rows.map(({ bodyText, ...row }) => ({
    ...row,
    snippet: snippetOf(bodyText),
  }));
}
