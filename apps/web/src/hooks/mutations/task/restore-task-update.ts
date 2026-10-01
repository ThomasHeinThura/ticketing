import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";

function taskFrom(project: ProjectWithTasks, taskId: string) {
  for (const column of project.columns) {
    const task = column.tasks.find(({ id }) => id === taskId);
    if (task) return task;
  }
  return (
    project.plannedTasks.find(({ id }) => id === taskId) ??
    project.archivedTasks.find(({ id }) => id === taskId)
  );
}

export function sameFullTaskWrite(
  left: Task | undefined,
  right: Task | undefined,
) {
  if (!left || !right) return false;
  return (
    left.projectId === right.projectId &&
    left.version === right.version &&
    left.updatedAt === right.updatedAt &&
    left.userId === right.userId &&
    left.assigneeId === right.assigneeId &&
    left.assigneeName === right.assigneeName &&
    left.assigneeImage === right.assigneeImage &&
    left.title === right.title &&
    left.description === right.description &&
    left.status === right.status &&
    left.priority === right.priority &&
    left.startDate === right.startDate &&
    left.dueDate === right.dueDate &&
    left.position === right.position &&
    left.columnId === right.columnId &&
    JSON.stringify(left.labels ?? []) === JSON.stringify(right.labels ?? []) &&
    JSON.stringify(left.externalLinks ?? []) ===
      JSON.stringify(right.externalLinks ?? [])
  );
}

function taskLocation(project: ProjectWithTasks, taskId: string) {
  for (const column of project.columns) {
    const index = column.tasks.findIndex(({ id }) => id === taskId);
    if (index !== -1) {
      return {
        kind: "column" as const,
        columnId: column.id,
        tasks: column.tasks,
        index,
      };
    }
  }
  const plannedIndex = project.plannedTasks.findIndex(
    ({ id }) => id === taskId,
  );
  if (plannedIndex !== -1) {
    return {
      kind: "planned" as const,
      tasks: project.plannedTasks,
      index: plannedIndex,
    };
  }
  const archivedIndex = project.archivedTasks.findIndex(
    ({ id }) => id === taskId,
  );
  if (archivedIndex !== -1) {
    return {
      kind: "archived" as const,
      tasks: project.archivedTasks,
      index: archivedIndex,
    };
  }
  return undefined;
}

export function restoreTaskUpdate(
  current: ProjectWithTasks,
  authoritative: ProjectWithTasks,
  taskId: string,
  expectedCurrent: Task | undefined,
): ProjectWithTasks {
  const currentTask = taskFrom(current, taskId);
  const authoritativeTask = taskFrom(authoritative, taskId);
  const authoritativeLocation = taskLocation(authoritative, taskId);
  if (
    !authoritativeTask ||
    !authoritativeLocation ||
    !sameFullTaskWrite(currentTask, expectedCurrent)
  ) {
    return current;
  }

  const restored: ProjectWithTasks = {
    ...current,
    columns: current.columns.map((column) => ({
      ...column,
      tasks: column.tasks.filter(({ id }) => id !== taskId),
    })),
    plannedTasks: current.plannedTasks.filter(({ id }) => id !== taskId),
    archivedTasks: current.archivedTasks.filter(({ id }) => id !== taskId),
  };

  let destination: Task[];
  if (authoritativeLocation.kind === "column") {
    const column = restored.columns.find(
      ({ id }) => id === authoritativeLocation.columnId,
    );
    if (!column) return current;
    destination = column.tasks;
  } else if (authoritativeLocation.kind === "planned") {
    destination = restored.plannedTasks;
  } else {
    destination = restored.archivedTasks;
  }

  const authoritativeIds = authoritativeLocation.tasks.map(({ id }) => id);
  const destinationIds = new Set(destination.map(({ id }) => id));
  const nextNeighbor = authoritativeIds
    .slice(authoritativeLocation.index + 1)
    .find((id) => destinationIds.has(id));
  const previousNeighbor = authoritativeIds
    .slice(0, authoritativeLocation.index)
    .reverse()
    .find((id) => destinationIds.has(id));
  const insertAt = nextNeighbor
    ? destination.findIndex(({ id }) => id === nextNeighbor)
    : previousNeighbor
      ? destination.findIndex(({ id }) => id === previousNeighbor) + 1
      : destination.length;
  destination.splice(insertAt, 0, authoritativeTask);

  return restored;
}
