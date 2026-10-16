import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  desc,
  eq,
  exists,
  isNull,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  projectTable,
  taskActivityTable,
  taskTable,
  userTable,
} from "../database/schema";

function taskReach(
  identity: ResolvedIdentity,
  taskId: SQLWrapper,
  executor: Executor,
  requireLive = false,
) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, taskId),
          ...(requireLive
            ? [isNull(projectTable.deletedAt), isNull(projectTable.archivedAt)]
            : []),
          currentProjectReachPredicate(
            identity,
            projectTable.id,
            projectTable.workspaceId,
            projectTable.organisationId,
            executor,
          ),
        ),
      ),
  );
}

/** Preserve the established task→project row-lock order with current persisted reach. */
export async function lockTaskAndAssertProjectLive(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  const [task] = await executor
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      userId: taskTable.userId,
      title: taskTable.title,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, taskId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .for("update", { of: taskTable });
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  const [project] = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, task.projectId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    )
    .for("share");
  if (!project) throw new HTTPException(404, { message: "Task not found" });
  return task;
}

export type NewTaskActivity = {
  taskId: string;
  type: string;
  userId: string;
  content: string | null;
  eventData?: Record<string, unknown> | null;
};

export async function insertTaskActivity(
  executor: Executor,
  identity: ResolvedIdentity,
  values: NewTaskActivity,
) {
  const select = executor
    .select({
      id: sql`${sql.param(createId(), taskActivityTable.id)}`.as("id"),
      taskId: taskTable.id,
      type: sql`${sql.param(values.type, taskActivityTable.type)}`.as("type"),
      createdAt: sql`now()`.as("createdAt"),
      updatedAt: sql`now()`.as("updatedAt"),
      userId: sql`${sql.param(values.userId, taskActivityTable.userId)}`.as(
        "userId",
      ),
      content: sql`${sql.param(values.content, taskActivityTable.content)}`.as(
        "content",
      ),
      eventData:
        sql`${sql.param(values.eventData ?? null, taskActivityTable.eventData)}`.as(
          "eventData",
        ),
      externalUserName:
        sql`${sql.param(null, taskActivityTable.externalUserName)}`.as(
          "externalUserName",
        ),
      externalUserAvatar:
        sql`${sql.param(null, taskActivityTable.externalUserAvatar)}`.as(
          "externalUserAvatar",
        ),
      externalSource:
        sql`${sql.param(null, taskActivityTable.externalSource)}`.as(
          "externalSource",
        ),
      externalUrl: sql`${sql.param(null, taskActivityTable.externalUrl)}`.as(
        "externalUrl",
      ),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, values.taskId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
  const [row] = await executor
    .insert(taskActivityTable)
    .select(select)
    .returning();
  return row;
}

/** A task mutation and its history row must commit or roll back together. */
export async function insertRequiredTaskActivity(
  executor: Executor,
  identity: ResolvedIdentity,
  values: NewTaskActivity,
) {
  const activity = await insertTaskActivity(executor, identity, values);
  if (!activity) throw new HTTPException(404, { message: "Task not found" });
  return activity;
}

export async function insertCommentActivity(
  executor: Executor,
  identity: ResolvedIdentity,
  values: {
    taskId: string;
    userId: string;
    content: string;
    external?: { userName: string; source: string };
  },
) {
  const select = executor
    .select({
      id: sql`${sql.param(createId(), taskActivityTable.id)}`.as("id"),
      taskId: taskTable.id,
      type: sql`${sql.param("comment", taskActivityTable.type)}`.as("type"),
      createdAt: sql`now()`.as("createdAt"),
      updatedAt: sql`now()`.as("updatedAt"),
      userId: sql`${sql.param(values.userId, taskActivityTable.userId)}`.as(
        "userId",
      ),
      content: sql`${sql.param(values.content, taskActivityTable.content)}`.as(
        "content",
      ),
      eventData: sql`${sql.param(null, taskActivityTable.eventData)}`.as(
        "eventData",
      ),
      externalUserName:
        sql`${sql.param(values.external?.userName ?? null, taskActivityTable.externalUserName)}`.as(
          "externalUserName",
        ),
      externalUserAvatar:
        sql`${sql.param(null, taskActivityTable.externalUserAvatar)}`.as(
          "externalUserAvatar",
        ),
      externalSource:
        sql`${sql.param(values.external?.source ?? null, taskActivityTable.externalSource)}`.as(
          "externalSource",
        ),
      externalUrl: sql`${sql.param(null, taskActivityTable.externalUrl)}`.as(
        "externalUrl",
      ),
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(taskTable.id, values.taskId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
  const [activity] = await executor
    .insert(taskActivityTable)
    .select(select)
    .returning();
  if (!activity) throw new HTTPException(404, { message: "Task not found" });
  return activity;
}

export async function findProjectWorkspaceId(
  executor: Executor,
  identity: ResolvedIdentity,
  projectId: string,
) {
  const [row] = await executor
    .select({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, projectId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
  return row;
}

export async function findUserName(userId: string) {
  const [user] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId));
  return user;
}

export async function findOwnComment(
  identity: ResolvedIdentity,
  userId: string,
  id: string,
  executor: Executor = db,
) {
  const [existing] = await executor
    .select({
      id: taskActivityTable.id,
      content: taskActivityTable.content,
      taskId: taskActivityTable.taskId,
    })
    .from(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.id, id),
        eq(taskActivityTable.userId, userId),
        eq(taskActivityTable.type, "comment"),
        taskReach(identity, taskActivityTable.taskId, executor),
      ),
    );
  return existing;
}

export async function deleteOwnComment(
  executor: Executor,
  identity: ResolvedIdentity,
  userId: string,
  id: string,
) {
  const [deleted] = await executor
    .delete(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.id, id),
        eq(taskActivityTable.userId, userId),
        eq(taskActivityTable.type, "comment"),
        taskReach(identity, taskActivityTable.taskId, executor, true),
      ),
    )
    .returning();
  return deleted;
}

export async function updateOwnCommentContent(
  executor: Executor,
  identity: ResolvedIdentity,
  userId: string,
  id: string,
  content: string,
) {
  const [updated] = await executor
    .update(taskActivityTable)
    .set({ content })
    .where(
      and(
        eq(taskActivityTable.id, id),
        eq(taskActivityTable.userId, userId),
        eq(taskActivityTable.type, "comment"),
        taskReach(identity, taskActivityTable.taskId, executor, true),
      ),
    )
    .returning();
  return updated;
}

export async function listTaskActivitiesNewestFirst(
  identity: ResolvedIdentity,
  taskId: string,
  executor: Executor = db,
) {
  return executor
    .select()
    .from(taskActivityTable)
    .where(
      and(
        eq(taskActivityTable.taskId, taskId),
        taskReach(identity, taskActivityTable.taskId, executor),
      ),
    )
    .orderBy(desc(taskActivityTable.createdAt));
}
