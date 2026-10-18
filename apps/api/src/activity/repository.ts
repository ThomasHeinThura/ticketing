import { createId } from "@paralleldrive/cuid2";
import type { ResolvedIdentity } from "@taskdesk/permissions";
import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import { currentProjectReachPredicate } from "../database/repositories/identity-scope.repository";
import { projectTable, taskActivityTable, taskTable } from "../database/schema";
import { lockTaskRowForIdentity } from "../task/repository";

type NewTaskActivity = {
  taskId: string;
  type: string;
  userId: string;
  content: string | null;
  eventData?: Record<string, unknown> | null;
};

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
