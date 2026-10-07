import type { SQL } from "drizzle-orm";
import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import db from "../database";
import {
  projectTable,
  taskActivityTable,
  taskTable,
  userTable,
  workspaceTable,
  workspaceUserTable,
} from "../database/schema";

export function findUserByEmail(email: string) {
  return db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email))
    .limit(1);
}

export function listWorkspaceIdsForUser(userId: string) {
  return db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));
}

export function findTaskByShortId(
  workspaceFilter: SQL | undefined,
  projectId: string | undefined,
  slugPattern: string,
  taskNumber: number,
) {
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
        workspaceFilter,
        projectId ? eq(taskTable.projectId, projectId) : undefined,
        ilike(projectTable.slug, slugPattern),
        eq(taskTable.number, taskNumber),
      ),
    )
    .limit(1);
}

export function searchTasks(
  workspaceFilter: SQL | undefined,
  projectId: string | undefined,
  searchPattern: string,
  relevanceScore: SQL<number>,
  limit: number,
) {
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
      relevanceScore: relevanceScore.as("relevanceScore"),
    })
    .from(taskTable)
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(
      and(
        workspaceFilter,
        projectId ? eq(taskTable.projectId, projectId) : undefined,
        or(
          ilike(taskTable.title, searchPattern),
          ilike(taskTable.description, searchPattern),
        ),
      ),
    )
    .orderBy(desc(relevanceScore), desc(taskTable.createdAt))
    .limit(limit);
}

export function searchProjects(
  workspaceFilter: SQL | undefined,
  searchPattern: string,
  relevanceScore: SQL<number>,
  limit: number,
) {
  return db
    .select({
      id: projectTable.id,
      name: projectTable.name,
      description: projectTable.description,
      slug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      workspaceName: workspaceTable.name,
      createdAt: projectTable.createdAt,
      relevanceScore: relevanceScore.as("relevanceScore"),
    })
    .from(projectTable)
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .where(
      and(
        workspaceFilter,
        or(
          ilike(projectTable.name, searchPattern),
          ilike(projectTable.description, searchPattern),
        ),
      ),
    )
    .orderBy(desc(relevanceScore), desc(projectTable.createdAt))
    .limit(limit);
}

export function searchWorkspaces(
  workspaceIds: string[],
  searchPattern: string,
  relevanceScore: SQL<number>,
  limit: number,
) {
  return db
    .select({
      id: workspaceTable.id,
      name: workspaceTable.name,
      description: workspaceTable.description,
      createdAt: workspaceTable.createdAt,
      relevanceScore: relevanceScore.as("relevanceScore"),
    })
    .from(workspaceTable)
    .leftJoin(
      workspaceUserTable,
      eq(workspaceTable.id, workspaceUserTable.workspaceId),
    )
    .where(
      and(
        inArray(workspaceTable.id, workspaceIds),
        or(
          ilike(workspaceTable.name, searchPattern),
          ilike(workspaceTable.description, searchPattern),
        ),
      ),
    )
    .orderBy(desc(relevanceScore), desc(workspaceTable.createdAt))
    .limit(limit);
}

export function searchActivities(
  workspaceFilter: SQL | undefined,
  projectId: string | undefined,
  searchPattern: string,
  searchableText: SQL<string>,
  relevanceScore: SQL<number>,
  type: string,
  limit: number,
) {
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
      relevanceScore: relevanceScore.as("relevanceScore"),
    })
    .from(taskActivityTable)
    .leftJoin(taskTable, eq(taskActivityTable.taskId, taskTable.id))
    .leftJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .leftJoin(workspaceTable, eq(projectTable.workspaceId, workspaceTable.id))
    .leftJoin(userTable, eq(taskActivityTable.userId, userTable.id))
    .where(
      and(
        workspaceFilter,
        projectId ? eq(taskTable.projectId, projectId) : undefined,
        or(
          ilike(searchableText, searchPattern),
          ilike(taskTable.title, searchPattern),
        ),
        type === "comments" ? eq(taskActivityTable.type, "comment") : undefined,
      ),
    )
    .orderBy(desc(relevanceScore), desc(taskActivityTable.createdAt))
    .limit(limit);
}
