import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import {
  personTable,
  projectTable,
  savedViewTable,
  stateTable,
  stateTemplateTable,
  teamMemberTable,
  userTable,
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
  const reachableProjects =
    params.reachableProjectIds.length > 0
      ? sql`wi.project_id IN (${sql.join(
          params.reachableProjectIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`false`;
  /**
   * Plain text of the rich-text description's text nodes (or its JSON string value).
   * Keep this expression aligned with the matching expression GIN index in schema.ts.
   */
  const aliasedDescriptionText = sql<string>`coalesce(
    case
      when jsonb_typeof(wi.description) = 'string' then wi.description #>> '{}'
      else jsonb_path_query_array(wi.description, 'lax $.**.text')::text
    end, '')`;
  const scope = sql`
    wi.workspace_id = ${params.workspaceId}
    AND wi.deleted_at IS NULL
    AND wi.archived_at IS NULL
    AND p.deleted_at IS NULL
    AND p.archived_at IS NULL
    AND ${reachableProjects}
    ${params.projectId ? sql`AND wi.project_id = ${params.projectId}` : sql``}
  `;

  // Keep the searchable predicates in independent, bounded branches. The combined OR made
  // PostgreSQL scan every live work item before it could apply the relevance sort, defeating
  // both the title trigram index and the normalised key-prefix B-tree. The three public branch
  // limits are safe: any row in the global top K is in at least one branch that grants its
  // winning score, and K rows ahead of it in that branch also rank ahead globally.
  const result = await db.execute(sql`
    WITH
    key_candidates AS (
      SELECT wi.id, CASE WHEN lower(wi.key) = ${lower} THEN 100 ELSE 12 END AS score,
             wi.created_at
        FROM work_item AS wi
        JOIN project AS p ON p.id = wi.project_id
       WHERE ${scope}
         AND lower(wi.key) LIKE ${prefix}
       ORDER BY score DESC, wi.created_at DESC, wi.id
       LIMIT ${limit}
    ),
    alias_distinct AS (
      SELECT wi.id, max(wi.created_at) AS created_at
        FROM work_item_key_alias AS alias
        JOIN work_item AS wi ON wi.id = alias.work_item_id
        JOIN project AS p ON p.id = wi.project_id
       WHERE ${scope}
         AND lower(alias.old_key) = ${lower}
       GROUP BY wi.id
    ),
    alias_candidates AS (
      SELECT id, 90 AS score, created_at
        FROM alias_distinct
       ORDER BY score DESC, created_at DESC, id
       LIMIT ${limit}
    ),
    title_candidates AS (
      SELECT wi.id,
             CASE
               WHEN lower(wi.title) = ${lower} THEN 10
               WHEN lower(wi.title) LIKE ${prefix} THEN 8
               ELSE 6
             END AS score,
             wi.created_at
        FROM work_item AS wi
        JOIN project AS p ON p.id = wi.project_id
       WHERE ${scope}
         AND wi.title ILIKE ${contains}
       ORDER BY score DESC, wi.created_at DESC, wi.id
       LIMIT ${limit}
    ),
    description_candidates AS (
      SELECT wi.id, 2 AS score, wi.created_at
        FROM work_item AS wi
        JOIN project AS p ON p.id = wi.project_id
       WHERE ${scope}
         AND lower(${aliasedDescriptionText}) LIKE ${contains}
       ORDER BY score DESC, wi.created_at DESC, wi.id
       LIMIT ${limit}
    ),
    candidate_scores AS (
      SELECT id, max(score) AS relevance_score, max(created_at) AS created_at
        FROM (
          SELECT id, score, created_at FROM key_candidates
          UNION ALL
          SELECT id, score, created_at FROM alias_candidates
          UNION ALL
          SELECT id, score, created_at FROM title_candidates
          UNION ALL
          SELECT id, score, created_at FROM description_candidates
        ) AS candidates
       GROUP BY id
       ORDER BY relevance_score DESC, created_at DESC, id
       LIMIT ${limit}
    )
    SELECT wi.id,
           wi.key,
           wi.title,
           wi.number,
           wi.priority,
           state_template.name AS "stateName",
           wi.project_id AS "projectId",
           p.name AS "projectName",
           p.slug AS "projectSlug",
           wi.workspace_id AS "workspaceId",
           w.name AS "workspaceName",
           wi.created_at AS "createdAt",
           candidate_scores.relevance_score AS "relevanceScore"
      FROM candidate_scores
      JOIN work_item AS wi ON wi.id = candidate_scores.id
      JOIN project AS p ON p.id = wi.project_id
      JOIN state AS state ON state.id = wi.state_id
                         AND state.project_id = wi.project_id
      JOIN state_template AS state_template
        ON state_template.id = state.state_template_id
      LEFT JOIN workspace AS w ON w.id = wi.workspace_id
     ORDER BY candidate_scores.relevance_score DESC,
              wi.created_at DESC,
              wi.id
  `);

  const rows = result.rows as Array<
    Omit<CanonicalWorkItemRow, "createdAt"> & { createdAt: Date | string }
  >;
  return rows.map((row) => ({
    ...row,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt
        : new Date(`${row.createdAt.replace(" ", "T")}Z`),
  }));
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
