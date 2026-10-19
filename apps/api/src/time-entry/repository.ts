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
  timeEntryTable,
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
  typeof timeEntryTable.$inferInsert,
  | "id"
  | "taskId"
  | "userId"
  | "description"
  | "startTime"
  | "endTime"
  | "duration"
>;
export type TimeEntryChanges = Pick<
  typeof timeEntryTable.$inferInsert,
  "startTime" | "endTime" | "duration" | "description"
>;

export async function insertTimeEntry(
  executor: Executor,
  identity: ResolvedIdentity,
  values: NewTimeEntry,
) {
  const statement = executor
    .select({
      id: sql`${sql.param(values.id === undefined ? createId() : values.id, timeEntryTable.id)}`.as(
        "id",
      ),
      taskId: taskTable.id,
      userId: sql`${sql.param(values.userId, timeEntryTable.userId)}`.as(
        "userId",
      ),
      description:
        sql`${sql.param(values.description, timeEntryTable.description)}`.as(
          "description",
        ),
      startTime:
        sql`${sql.param(values.startTime, timeEntryTable.startTime)}`.as(
          "startTime",
        ),
      endTime:
        sql`${sql.param(values.endTime ?? null, timeEntryTable.endTime)}`.as(
          "endTime",
        ),
      duration:
        sql`${sql.param(values.duration === undefined ? 0 : values.duration, timeEntryTable.duration)}`.as(
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
    .insert(timeEntryTable)
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
    .update(timeEntryTable)
    .set(changes)
    .where(
      and(
        eq(timeEntryTable.id, id),
        taskReach(identity, timeEntryTable.taskId, executor, true),
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
    .from(timeEntryTable)
    .where(
      and(
        eq(timeEntryTable.id, id),
        taskReach(identity, timeEntryTable.taskId, executor),
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
    .select({ id: timeEntryTable.id, taskId: timeEntryTable.taskId })
    .from(timeEntryTable)
    .where(
      and(
        eq(timeEntryTable.id, id),
        exists(
          executor
            .select({ one: sql`1` })
            .from(taskTable)
            .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
            .where(
              and(
                eq(taskTable.id, timeEntryTable.taskId),
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
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      userId: timeEntryTable.userId,
      userName: userTable.name,
      description: timeEntryTable.description,
      startTime: timeEntryTable.startTime,
      endTime: timeEntryTable.endTime,
      duration: timeEntryTable.duration,
      createdAt: timeEntryTable.createdAt,
      updatedAt: timeEntryTable.updatedAt,
    })
    .from(timeEntryTable)
    .leftJoin(userTable, eq(timeEntryTable.userId, userTable.id))
    .where(
      and(
        eq(timeEntryTable.taskId, taskId),
        taskReach(identity, timeEntryTable.taskId, executor),
      ),
    )
    .orderBy(timeEntryTable.startTime);
}
