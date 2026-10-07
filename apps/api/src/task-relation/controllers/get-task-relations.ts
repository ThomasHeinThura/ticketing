import db from "../../database";
import { listRelationsForTask, listRelationTasks } from "../repository";

async function getTaskRelations(taskId: string, workspaceId: string) {
  const relations = await listRelationsForTask(db, taskId);

  const taskIds = new Set<string>();
  for (const rel of relations) {
    taskIds.add(rel.sourceTaskId);
    taskIds.add(rel.targetTaskId);
  }

  const tasks = new Map<
    string,
    {
      id: string;
      version: number;
      title: string;
      status: string;
      priority: string | null;
      number: number | null;
      projectId: string;
      userId: string | null;
      assigneeName: string | null;
    }
  >();

  if (taskIds.size > 0) {
    const taskRows = await listRelationTasks(db, [...taskIds], workspaceId);

    for (const task of taskRows) {
      tasks.set(task.id, task);
    }
  }

  return relations
    .filter((rel) => tasks.has(rel.sourceTaskId) && tasks.has(rel.targetTaskId))
    .map((rel) => ({
      ...rel,
      sourceTask: tasks.get(rel.sourceTaskId) ?? null,
      targetTask: tasks.get(rel.targetTaskId) ?? null,
    }));
}

export default getTaskRelations;
