import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import {
  personTable,
  projectTable,
  savedViewTable,
  stateTable,
  stateTemplateTable,
  teamMemberTable,
  userTable,
  workItemKeyAliasTable,
  workItemTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import { projectScopeInReach } from "../view/repository";
import { escapeLikePattern } from "./like-pattern";

/**
 * Canonical (work_item based) global search, SV-1/SV-3/SV-4/SV-7/SV-8/SV-9.
 *
 * Every statement here takes the caller's already-resolved project reach as plain ids, so a
 * hidden project's rows can never be selected, ranked or counted. Soft-deleted/archived
 * work items and projects are excluded in SQL.
 */

/** Minimum query length before the trigram typo fallback runs (the index needs trigrams). */
export const TYPO_FALLBACK_MIN_LENGTH = 3;

export type CanonicalWorkItemRow = {
  id: string;
  key: string;
  title: string;
  number: number;
  priority: string | null;
  stateName: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  workspaceId: string;
  workspaceName: string | null;
  createdAt: Date;
  relevanceScore: number;
};

/**
 * Plain text of a rich-text `description` document: every `text` node of the document, or the
 * string itself when the description is stored as a JSON string. Searching the raw jsonb cast
 * would also match structural keys such as `paragraph`.
 */
const descriptionText = sql<string>`coalesce(
  case
    when jsonb_typeof(${workItemTable.description}) = 'string'
      then ${workItemTable.description} #>> '{}'
    else jsonb_path_query_array(${workItemTable.description}, 'lax $.**.text')::text
  end, '')`;

function workItemBaseConditions(params: {
  workspaceId: string;
  reachableProjectIds: string[];
  projectId?: string;
}) {
  return [
    eq(workItemTable.workspaceId, params.workspaceId),
    isNull(workItemTable.deletedAt),
    isNull(workItemTable.archivedAt),
    isNull(projectTable.deletedAt),
    isNull(projectTable.archivedAt),
    params.reachableProjectIds.length > 0
      ? inArray(workItemTable.projectId, params.reachableProjectIds)
      : sql`false`,
    params.projectId
      ? eq(workItemTable.projectId, params.projectId)
      : undefined,
  ];
}

const workItemColumns = {
  id: workItemTable.id,
  key: workItemTable.key,
  title: workItemTable.title,
  number: workItemTable.number,
  priority: workItemTable.priority,
  stateName: stateTemplateTable.name,
  projectId: workItemTable.projectId,
  projectName: projectTable.name,
  projectSlug: projectTable.slug,
  workspaceId: workItemTable.workspaceId,
  workspaceName: workspaceTable.name,
  createdAt: workItemTable.createdAt,
};

/**
 * Work items matching `term`: exact key (or a retired key alias) first, then key prefix,
 * title (exact, prefix, contains) above description. Prefix and contains matching run on the
 * lowercased text so results update as the user types (SV-8).
 */
export async function searchCanonicalWorkItems(params: {
  workspaceId: string;
  reachableProjectIds: string[];
  projectId?: string;
  term: string;
  limit: number;
}): Promise<CanonicalWorkItemRow[]> {
  const { term, limit } = params;
  const lower = term.toLowerCase();
  const prefix = `${escapeLikePattern(lower)}%`;
  const contains = `%${escapeLikePattern(lower)}%`;
  const aliasMatch = db
    .select({ id: workItemKeyAliasTable.workItemId })
    .from(workItemKeyAliasTable)
    .where(sql`lower(${workItemKeyAliasTable.oldKey}) = ${lower}`);

  const relevance = sql<number>`
    CASE
      WHEN lower(${workItemTable.key}) = ${lower} THEN 100
      WHEN ${workItemTable.id} IN (${aliasMatch}) THEN 90
      WHEN lower(${workItemTable.key}) LIKE ${prefix} THEN 12
      WHEN lower(${workItemTable.title}) = ${lower} THEN 10
      WHEN lower(${workItemTable.title}) LIKE ${prefix} THEN 8
      WHEN lower(${workItemTable.title}) LIKE ${contains} THEN 6
      WHEN lower(${descriptionText}) LIKE ${contains} THEN 2
      ELSE 1
    END`;

  return await db
    .select({ ...workItemColumns, relevanceScore: relevance.as("relevance") })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(
      stateTable,
      and(
        eq(stateTable.id, workItemTable.stateId),
        eq(stateTable.projectId, workItemTable.projectId),
      ),
    )
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .leftJoin(workspaceTable, eq(workspaceTable.id, workItemTable.workspaceId))
    .where(
      and(
        ...workItemBaseConditions(params),
        or(
          sql`lower(${workItemTable.key}) LIKE ${prefix}`,
          sql`${workItemTable.id} IN (${aliasMatch})`,
          ilike(workItemTable.title, contains),
          sql`lower(${descriptionText}) LIKE ${contains}`,
        ),
      ),
    )
    .orderBy(desc(relevance), desc(workItemTable.createdAt), workItemTable.id)
    .limit(limit);
}

/**
 * SV-9: `pg_trgm` typo fallback on the title (`work_item_title_trgm_idx`, migration 0103).
 * Only called when the exact/prefix/contains pass left room in the page. The `%` operator uses
 * the GIN index; the similarity() value only orders the rows.
 */
export async function searchCanonicalWorkItemsFuzzy(params: {
  workspaceId: string;
  reachableProjectIds: string[];
  projectId?: string;
  term: string;
  excludeIds: string[];
  limit: number;
}): Promise<CanonicalWorkItemRow[]> {
  const { term, limit, excludeIds } = params;
  if (term.length < TYPO_FALLBACK_MIN_LENGTH) return [];
  const similarity = sql<number>`similarity(${workItemTable.title}, ${term})`;
  return await db
    .select({
      ...workItemColumns,
      // Below every non-fuzzy score (the lowest is 1), above nothing else.
      relevanceScore: sql<number>`${similarity} * 0.9`.as("relevance"),
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .innerJoin(
      stateTable,
      and(
        eq(stateTable.id, workItemTable.stateId),
        eq(stateTable.projectId, workItemTable.projectId),
      ),
    )
    .innerJoin(
      stateTemplateTable,
      eq(stateTemplateTable.id, stateTable.stateTemplateId),
    )
    .leftJoin(workspaceTable, eq(workspaceTable.id, workItemTable.workspaceId))
    .where(
      and(
        ...workItemBaseConditions(params),
        sql`${workItemTable.title} % ${term}`,
        excludeIds.length > 0
          ? sql`${workItemTable.id} NOT IN (${sql.join(
              excludeIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : undefined,
      ),
    )
    .orderBy(desc(similarity), workItemTable.id)
    .limit(limit);
}

export type CanonicalPersonRow = {
  id: string;
  userId: string | null;
  name: string;
  jobTitle: string | null;
  createdAt: Date;
  relevanceScore: number;
};

/**
 * Active staff-side members of the searched workspace, matched by display name. Customer-side
 * people and members of other workspaces never appear; only the name and job title are
 * returned (no email).
 */
export async function searchWorkspacePeople(params: {
  workspaceId: string;
  term: string;
  limit: number;
}): Promise<CanonicalPersonRow[]> {
  const lower = params.term.toLowerCase();
  const prefix = `${escapeLikePattern(lower)}%`;
  const contains = `%${escapeLikePattern(lower)}%`;
  const name = sql<string>`coalesce(${personTable.displayName}, ${userTable.name})`;
  const relevance = sql<number>`
    CASE
      WHEN lower(${name}) = ${lower} THEN 10
      WHEN lower(${name}) LIKE ${prefix} THEN 8
      ELSE 6
    END`;
  return await db
    .select({
      id: personTable.id,
      userId: personTable.userId,
      name,
      jobTitle: personTable.jobTitle,
      createdAt: personTable.createdAt,
      relevanceScore: relevance.as("relevance"),
    })
    .from(personTable)
    .innerJoin(userTable, eq(userTable.id, personTable.userId))
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, params.workspaceId),
      ),
    )
    .where(
      and(
        eq(personTable.side, "staff"),
        eq(personTable.active, true),
        sql`${workspaceUserTable.role} <> 'customer'`,
        sql`lower(${name}) LIKE ${contains}`,
      ),
    )
    .orderBy(desc(relevance), name, personTable.id)
    .limit(params.limit);
}

export type CanonicalSavedViewRow = {
  id: string;
  name: string;
  layout: string;
  scope: string;
  scopeId: string;
  workspaceId: string;
  createdAt: Date;
  relevanceScore: number;
};

/**
 * Saved views the caller may open (private to them, shared with one of their teams, or
 * workspace-wide), with project-scoped views limited to projects in reach (#740) -- the same
 * visibility rule as the saved view list.
 */
export async function searchSavedViews(params: {
  workspaceId: string;
  personId: string;
  userId: string;
  reachableProjectIds: string[];
  term: string;
  limit: number;
}): Promise<CanonicalSavedViewRow[]> {
  const memberships = await db
    .select({ teamId: teamMemberTable.teamId })
    .from(teamMemberTable)
    .where(eq(teamMemberTable.userId, params.userId));
  const teamIds = memberships.map(({ teamId }) => teamId);
  const lower = params.term.toLowerCase();
  const prefix = `${escapeLikePattern(lower)}%`;
  const contains = `%${escapeLikePattern(lower)}%`;
  const relevance = sql<number>`
    CASE
      WHEN lower(${savedViewTable.name}) = ${lower} THEN 10
      WHEN lower(${savedViewTable.name}) LIKE ${prefix} THEN 8
      ELSE 6
    END`;
  return await db
    .select({
      id: savedViewTable.id,
      name: savedViewTable.name,
      layout: savedViewTable.layout,
      scope: savedViewTable.scope,
      scopeId: savedViewTable.scopeId,
      workspaceId: savedViewTable.workspaceId,
      createdAt: savedViewTable.createdAt,
      relevanceScore: relevance.as("relevance"),
    })
    .from(savedViewTable)
    .where(
      and(
        eq(savedViewTable.workspaceId, params.workspaceId),
        or(
          eq(savedViewTable.visibility, "workspace"),
          eq(savedViewTable.createdBy, params.personId),
          teamIds.length > 0
            ? and(
                eq(savedViewTable.visibility, "team"),
                inArray(savedViewTable.sharedWithTeamId, teamIds),
              )
            : undefined,
        ),
        projectScopeInReach(params.reachableProjectIds),
        sql`lower(${savedViewTable.name}) LIKE ${contains}`,
      ),
    )
    .orderBy(desc(relevance), savedViewTable.name, savedViewTable.id)
    .limit(params.limit);
}
