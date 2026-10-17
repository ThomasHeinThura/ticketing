import {
  listRelationsOfTask,
  listTaskSummariesInWorkspace,
} from "../repository";

async function getTaskRelations(
  taskId: string,
  workspaceId: string,
  /** Whether the caller reaches the task's project; unreachable related tasks are dropped. */
  canReachTask: (task: {
    id: string;
    projectId: string;
    workspaceId: string;
  }) => Promise<boolean>,
) {
  const relations = await listRelationsOfTask(taskId);

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
    const taskRows = await listTaskSummariesInWorkspace(
      [...taskIds],
      workspaceId,
    );

    for (const task of taskRows) {
      // A related task outside the caller's project reach is omitted entirely, with its
      // relation: its title, status, priority and assignee must not reach the caller.
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
