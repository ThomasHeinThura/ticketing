import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  taskActivityTable,
  taskTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";
import { escapeLikePattern } from "./like-pattern";

/**
 * Query ownership for global search (issue #580). Every function awaits and returns rows.
 *
 * The project scope filter is composed here, once per statement, from plain inputs: the
 * workspace restriction (one workspace, or every workspace the caller belongs to), the
 * soft-delete exclusion (#187) and the caller's reachable project ids (#740). The
 * controller never sees a SQL fragment, so no statement can omit it.
 */

export type SearchScope = {
  /** Restricts to one workspace when set, else to `accessibleWorkspaceIds`. */
  workspaceId?: string;
  accessibleWorkspaceIds: string[];
  /** Projects the caller reaches; an empty list matches nothing (`false`). */
  reachableProjectIds: string[];
};

function projectScopeFilter(scope: SearchScope) {
  return and(
    scope.workspaceId
      ? eq(projectTable.workspaceId, scope.workspaceId)
      : inArray(projectTable.workspaceId, scope.accessibleWorkspaceIds),
    isNull(projectTable.deletedAt),
    scope.reachableProjectIds.length > 0
      ? inArray(projectTable.id, scope.reachableProjectIds)
      : sql`false`,
  );
}

/** Users matching an email, at most one row. */
export async function findUserIdsByEmail(email: string) {
  return db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
}

export async function listUserWorkspaceIds(userId: string) {
  return db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));
}

/** The task whose project key (case-insensitive) and number match, at most one row. */
export async function findTasksByShortId(params: {
  scope: SearchScope;
  projectId?: string;
  slug: string;
  taskNumber: number;
}) {
  const { scope, projectId, slug, taskNumber } = params;
  return db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      description: taskTable.description,
      projectId: taskTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      workspaceName: workspaceTable.name,
      userId: taskTable.userId,
      userName: userTable.name,
      createdAt: taskTable.createdAt,
      taskNumber: taskTable.number,
      version: taskTable.version,
      priority: taskTable.priority,
      status: taskTable.status,
    })
    .from(taskTable)
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(
      and(
        projectScopeFilter(scope),
        projectId ? eq(taskTable.projectId, projectId) : undefined,
        // A project key may hold `_`, which `ilike` reads as "any one
        // character", so `DE_-23` would also match a task in `DEP` and the
        // `limit(1)` below would pick whichever came back first. Escaping
        // keeps the case-insensitive comparison and drops the wildcards.
        ilike(projectTable.slug, escapeLikePattern(slug)),
        eq(taskTable.number, taskNumber),
      ),
    )
    .limit(1);
}

export async function searchTasks(params: {
  scope: SearchScope;
  projectId?: string;
  searchPattern: string;
  limit: number;
}) {
  const { scope, projectId, searchPattern, limit } = params;
  const taskRelevanceScore = sql<number>`
      CASE
        WHEN LOWER(${taskTable.title}) LIKE ${searchPattern} THEN 3
        WHEN LOWER(${taskTable.description}) LIKE ${searchPattern} THEN 2
        ELSE 1
      END
    `;

  return db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      description: taskTable.description,
      projectId: taskTable.projectId,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      workspaceName: workspaceTable.name,
      userId: taskTable.userId,
      userName: userTable.name,
      createdAt: taskTable.createdAt,
      taskNumber: taskTable.number,
      version: taskTable.version,
      priority: taskTable.priority,
      status: taskTable.status,
      relevanceScore: taskRelevanceScore.as("relevanceScore"),
    })
    .from(taskTable)
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(
      and(
        projectScopeFilter(scope),
        projectId ? eq(taskTable.projectId, projectId) : undefined,
        or(
          ilike(taskTable.title, searchPattern),
          ilike(taskTable.description, searchPattern),
        ),
      ),
    )
    .orderBy(desc(taskRelevanceScore), desc(taskTable.createdAt))
    .limit(limit);
}

export async function searchProjects(params: {
  scope: SearchScope;
  searchPattern: string;
  limit: number;
}) {
  const { scope, searchPattern, limit } = params;
  const projectRelevanceScore = sql<number>`
      CASE
        WHEN LOWER(${projectTable.name}) LIKE ${searchPattern} THEN 3
        WHEN LOWER(${projectTable.description}) LIKE ${searchPattern} THEN 2
        ELSE 1
      END
    `;

  return db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      description: projectTable.description,
      slug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      workspaceName: workspaceTable.name,
      createdAt: projectTable.createdAt,
      relevanceScore: projectRelevanceScore.as("relevanceScore"),
    })
    .from(projectTable)
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(
      and(
        projectScopeFilter(scope),
        or(
          ilike(projectTable.name, searchPattern),
          ilike(projectTable.description, searchPattern),
        ),
      ),
    )
    .orderBy(desc(projectRelevanceScore), desc(projectTable.createdAt))
    .limit(limit);
}

export async function searchWorkspaces(params: {
  accessibleWorkspaceIds: string[];
  searchPattern: string;
  limit: number;
}) {
  const { accessibleWorkspaceIds, searchPattern, limit } = params;
  const workspaceRelevanceScore = sql<number>`
      CASE
        WHEN LOWER(${workspaceTable.name}) LIKE ${searchPattern} THEN 3
        WHEN LOWER(${workspaceTable.description}) LIKE ${searchPattern} THEN 2
        ELSE 1
      END
    `;

  return db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      description: workspaceTable.description,
      createdAt: workspaceTable.createdAt,
      relevanceScore: workspaceRelevanceScore.as("relevanceScore"),
    })
    .from(workspaceTable)
    .leftJoin(
      workspaceUserTable,
      eq(workspaceTable.id, workspaceUserTable.workspaceId),
    )
    .where(
      and(
        inArray(workspaceTable.id, accessibleWorkspaceIds),
        or(
          ilike(workspaceTable.name, searchPattern),
          ilike(workspaceTable.description, searchPattern),
        ),
      ),
    )
    .orderBy(desc(workspaceRelevanceScore), desc(workspaceTable.createdAt))
    .limit(limit);
}

export async function searchActivities(params: {
  scope: SearchScope;
  projectId?: string;
  /** `"comments"` restricts to comment-typed activity. */
  type: string;
  searchPattern: string;
  limit: number;
}) {
  const { scope, projectId, type, searchPattern, limit } = params;
  const searchableActivityText = sql<string>`COALESCE(${taskActivityTable.content}, CAST(${taskActivityTable.eventData} AS text), '')`;
  const activityRelevanceScore = sql<number>`
      CASE
        WHEN LOWER(${searchableActivityText}) LIKE ${searchPattern} THEN 2
        WHEN LOWER(${taskTable.title}) LIKE ${searchPattern} THEN 1
        ELSE 1
      END
    `;

  return db
    .select({
      id: taskActivityTable.id,
      type: taskActivityTable.type,
      content: taskActivityTable.content,
      eventData: taskActivityTable.eventData,
      taskId: taskActivityTable.taskId,
      taskTitle: taskTable.title,
      taskNumber: taskTable.number,
      projectId: projectTable.id,
      projectName: projectTable.name,
      projectSlug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      workspaceName: workspaceTable.name,
      userId: taskActivityTable.userId,
      userName: userTable.name,
      createdAt: taskActivityTable.createdAt,
      relevanceScore: activityRelevanceScore.as("relevanceScore"),
    })
    .from(taskActivityTable)
    .leftJoin(taskTable, eq(taskActivityTable.taskId, taskTable.id))
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(taskActivityTable.userId, userTable.id))
    .where(
      and(
        projectScopeFilter(scope),
        projectId ? eq(taskTable.projectId, projectId) : undefined,
        or(
          ilike(searchableActivityText, searchPattern),
          ilike(taskTable.title, searchPattern),
        ),
        type === "comments" ? eq(taskActivityTable.type, "comment") : undefined,
      ),
    )
    .orderBy(desc(activityRelevanceScore), desc(taskActivityTable.createdAt))
    .limit(limit);
}
