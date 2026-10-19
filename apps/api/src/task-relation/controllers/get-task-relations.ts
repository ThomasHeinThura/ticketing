import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  listRelationsOfTask,
  listTaskSummariesInWorkspace,
} from "../repository";

async function getTaskRelations(
  identity: ResolvedIdentity,
  taskId: string,
  workspaceId: string,
  canReachTask: (task: {
    id: string;
    projectId: string;
    workspaceId: string;
  }) => Promise<boolean>,
) {
  const relations = await listRelationsOfTask(identity, taskId);
  const taskIds = [
    ...new Set(
      relations.flatMap((rel) => [rel.sourceTaskId, rel.targetTaskId]),
    ),
  ];
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
  if (taskIds.length > 0) {
    const taskRows = await listTaskSummariesInWorkspace(
      identity,
      taskIds,
      workspaceId,
    );
    for (const task of taskRows) {
      if (await canReachTask({ ...task, workspaceId }))
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
