import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, exists, isNull, type SQLWrapper, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import {
  projectTable,
  taskTable,
  taskTimeEntryTable,
  userTable,
} from "../database/schema";

function taskReach(
  identity: ResolvedIdentity,
  taskId: SQLWrapper,
  executor: Executor,
  requireLiveProject = false,
) {
  return exists(
    executor
      .select({ one: sql`1` })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .where(
        and(
          eq(taskTable.id, taskId),
          isNull(projectTable.deletedAt),
          ...(requireLiveProject ? [isNull(projectTable.archivedAt)] : []),
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

/** Lock an admitted task, then its live project, in the established task→project order. */
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

export type NewTimeEntry = Pick<
  typeof taskTimeEntryTable.$inferInsert,
  | "id"
  | "taskId"
  | "userId"
  | "description"
  | "startTime"
  | "endTime"
  | "duration"
>;
export type TimeEntryChanges = Pick<
  typeof taskTimeEntryTable.$inferInsert,
  "startTime" | "endTime" | "duration" | "description"
>;

export async function insertTimeEntry(
  executor: Executor,
  identity: ResolvedIdentity,
  values: NewTimeEntry,
) {
  const statement = executor
    .select({
      id: sql`${sql.param(values.id === undefined ? createId() : values.id, taskTimeEntryTable.id)}`.as(
        "id",
      ),
      taskId: taskTable.id,
      userId: sql`${sql.param(values.userId, taskTimeEntryTable.userId)}`.as(
        "userId",
      ),
      description:
        sql`${sql.param(values.description, taskTimeEntryTable.description)}`.as(
          "description",
        ),
      startTime:
        sql`${sql.param(values.startTime, taskTimeEntryTable.startTime)}`.as(
          "startTime",
        ),
      endTime:
        sql`${sql.param(values.endTime ?? null, taskTimeEntryTable.endTime)}`.as(
          "endTime",
        ),
      duration:
        sql`${sql.param(values.duration === undefined ? 0 : values.duration, taskTimeEntryTable.duration)}`.as(
          "duration",
        ),
      createdAt: sql`now()`.as("createdAt"),
      updatedAt: sql`now()`.as("updatedAt"),
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
  const [created] = await executor
    .insert(taskTimeEntryTable)
    .select(statement)
    .returning();
  return created;
}

export async function updateTimeEntryById(
  executor: Executor,
  identity: ResolvedIdentity,
  id: string,
  changes: Partial<TimeEntryChanges>,
) {
  const [updated] = await executor
    .update(taskTimeEntryTable)
    .set(changes)
    .where(
      and(
        eq(taskTimeEntryTable.id, id),
        taskReach(identity, taskTimeEntryTable.taskId, executor, true),
      ),
    )
    .returning();
  return updated;
}

export async function findTimeEntryById(
  identity: ResolvedIdentity,
  id: string,
  executor: Executor = db,
) {
  const [timeEntry] = await executor
    .select()
    .from(taskTimeEntryTable)
    .where(
      and(
        eq(taskTimeEntryTable.id, id),
        taskReach(identity, taskTimeEntryTable.taskId, executor),
      ),
    );
  return timeEntry;
}

/** Return only the mutation target facts before locking its task and project. */
export async function findTimeEntryMutationTarget(
  identity: ResolvedIdentity,
  id: string,
  executor: Executor = db,
) {
  const [target] = await executor
    .select({ id: taskTimeEntryTable.id, taskId: taskTimeEntryTable.taskId })
    .from(taskTimeEntryTable)
    .where(
      and(
        eq(taskTimeEntryTable.id, id),
        exists(
          executor
            .select({ one: sql`1` })
            .from(taskTable)
            .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
            .where(
              and(
                eq(taskTable.id, taskTimeEntryTable.taskId),
                isNull(projectTable.deletedAt),
                currentProjectReachPredicate(
                  identity,
                  projectTable.id,
                  projectTable.workspaceId,
                  projectTable.organisationId,
                  executor,
                ),
              ),
            ),
        ),
      ),
    );
  return target;
}

export async function listTimeEntriesWithUserByTask(
  identity: ResolvedIdentity,
  taskId: string,
  executor: Executor = db,
) {
  return executor
    .select({
      id: taskTimeEntryTable.id,
      taskId: taskTimeEntryTable.taskId,
      userId: taskTimeEntryTable.userId,
      userName: userTable.name,
      description: taskTimeEntryTable.description,
      startTime: taskTimeEntryTable.startTime,
      endTime: taskTimeEntryTable.endTime,
      duration: taskTimeEntryTable.duration,
      createdAt: taskTimeEntryTable.createdAt,
      updatedAt: taskTimeEntryTable.updatedAt,
    })
    .from(taskTimeEntryTable)
    .leftJoin(userTable, eq(taskTimeEntryTable.userId, userTable.id))
    .where(
      and(
        eq(taskTimeEntryTable.taskId, taskId),
        taskReach(identity, taskTimeEntryTable.taskId, executor),
      ),
    )
    .orderBy(taskTimeEntryTable.startTime);
}
