import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { getProjectWorkspaceId } from "../../utils/assert-assignable-user";
import { getTaskByIdQuery } from "../repository";

async function getTask(taskId: string) {
  const task = await getTaskByIdQuery(db, taskId);

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
