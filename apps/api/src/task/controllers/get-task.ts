import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, userTable } from "../../database/schema";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";

async function getTask(taskId: string) {
  const task = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
      projectId: taskTable.projectId,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);

  const found = task[0];

  if (!found) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  // #202: a task inside a soft-deleted project is gone for ordinary use during the
  // project's 30-day recovery window (#187, PR-16), exactly like the project itself
  // (`get-project.ts`) and its task list (`get-tasks.ts`). `getProjectWorkspaceId`
  // applies that exclusion and throws 404; `delete-task.ts` calls this function, so
  // it inherits the freeze rather than needing its own check.
  await getProjectWorkspaceId(found.projectId);

  return found;
}

export default getTask;
