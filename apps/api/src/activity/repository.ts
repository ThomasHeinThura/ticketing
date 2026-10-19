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
import { lockTaskRowForIdentity } from "../task/repository";

type NewTaskActivity = {
  taskId: string;
  type: string;
  userId: string;
  content: string | null;
  eventData?: Record<string, unknown> | null;
};

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

/** Lock in task→project order and recheck the caller's current reach inside the write transaction. */
export async function lockTaskAndAssertProjectLiveForActivity(
  executor: Executor,
  identity: ResolvedIdentity,
  taskId: string,
) {
  const task = await lockTaskRowForIdentity(executor, identity, taskId);
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

export const lockTaskAndAssertProjectLive =
  lockTaskAndAssertProjectLiveForActivity;

/** Insert the public route's activity only while its task remains live and reachable. */
export async function insertTaskActivityForIdentity(
  executor: Executor,
  identity: ResolvedIdentity,
  values: NewTaskActivity,
) {
  const selectedActivity = executor
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
      externalUserName: sql`NULL`.as("externalUserName"),
      externalUserAvatar: sql`NULL`.as("externalUserAvatar"),
      externalSource: sql`NULL`.as("externalSource"),
      externalUrl: sql`NULL`.as("externalUrl"),
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
    .select(selectedActivity)
    .returning();
  return activity;
}

export const insertTaskActivity = insertTaskActivityForIdentity;

/** A task mutation and its history row must commit or roll back together. */
export async function insertRequiredTaskActivity(
  executor: Executor,
  identity: ResolvedIdentity,
  values: NewTaskActivity,
) {
  const activity = await insertTaskActivityForIdentity(
    executor,
    identity,
    values,
  );
  if (!activity) throw new HTTPException(404, { message: "Task not found" });
  return activity;
}

/** Store a task event already emitted by a successful write, even if archive wins delivery. */
export async function insertTaskEventActivityFromSubscriber(
  values: NewTaskActivity,
) {
  const [activity] = await db
    .insert(taskActivityTable)
    .values({
      taskId: values.taskId,
      type: values.type,
      userId: values.userId,
      content: values.content,
      eventData: values.eventData ?? null,
    })
    .returning();
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
