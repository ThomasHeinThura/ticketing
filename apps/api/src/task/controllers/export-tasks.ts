import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  findLiveProjectQuery,
  listExportTasksQuery,
  listTaskLabelsForTasksQuery,
} from "../repository";

async function exportTasks(projectId: string) {
  const project = await findLiveProjectQuery(db, projectId);

  if (!project) {
    throw new HTTPException(404, {
      message: "Project not found",
    });
  }

  const tasks = await listExportTasksQuery(db, projectId);

  const taskIds = tasks.map((task) => task.id);

  const labelsData =
    taskIds.length > 0 ? await listTaskLabelsForTasksQuery(db, taskIds) : [];

  const taskLabelsMap = new Map<
    string,
    Array<{ name: string; color: string }>
  >();
  for (const label of labelsData) {
    if (label.taskId) {
      if (!taskLabelsMap.has(label.taskId)) {
        taskLabelsMap.set(label.taskId, []);
      }
      taskLabelsMap.get(label.taskId)?.push({
        name: label.name,
        color: label.color,
      });
    }
  }

  return {
    project: {
      name: project.name,
      slug: project.slug,
      description: project.description,
      exportedAt: new Date().toISOString(),
    },
    tasks: tasks.map((task) => ({
      version: task.version,
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: task.priority || "low",
      dueDate: task.dueDate ? new Date(task.dueDate).toISOString() : null,
      startDate: task.startDate ? new Date(task.startDate).toISOString() : null,
      userId: task.userId || null,
      labels: taskLabelsMap.get(task.id) || [],
    })),
  };
}

export default exportTasks;
