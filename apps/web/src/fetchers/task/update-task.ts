import { client } from "@taskdesk/libs";
import type { InferRequestType } from "hono/client";
import { HttpError } from "@/lib/http-error";
import type Task from "@/types/task";

type UpdateTaskPriority = InferRequestType<
  (typeof client)["v2"]["task"][":id"]["$put"]
>["json"]["priority"];

async function updateTask(taskId: string, task: Task) {
  const response = await client.v2.task[":id"].$put({
    param: { id: taskId },
    header: { "if-match": `"${task.version}"` },
    json: {
      userId: task.userId || "",
      title: task.title,
      description: task.description || "",
      status: task.status,
      // The API validates priority against a picklist that has no empty
      // member, so a task carrying no priority has to be sent as the explicit
      // "no priority" value rather than "". Sending "" rejected the whole
      // update, which is what broke dragging every imported task.
      priority: (task.priority || "no-priority") as UpdateTaskPriority,
      startDate: task.startDate?.toString(),
      dueDate: task.dueDate?.toString(),
      position: task.position ?? 0,
      projectId: task.projectId,
    },
  });

  if (!response.ok) {
    throw new HttpError(response.status, "Failed to update task");
  }

  const data = await response.json();

  return data;
}

export default updateTask;
