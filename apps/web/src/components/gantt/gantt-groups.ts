/** The task fields the timeline needs to group rows. Kept minimal so the helper stays pure. */
type GroupableTask = {
  id: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
};

export type GanttRow<TTask extends GroupableTask> =
  | { kind: "task"; task: TTask }
  | {
      kind: "group";
      id: string;
      /** The assignee's name; `null` is the unassigned bucket. */
      name: string | null;
      count: number;
    };

export const GANTT_UNASSIGNED_GROUP_ID = "gantt-group:none";

/**
 * `VW-27`: the timeline's rows, optionally grouped by assignee. Each group is a heading row
 * followed by that assignee's bars in the order they arrived (start date), assignees sorted by
 * name, the unassigned bucket last. Without a grouping the rows are the tasks, untouched.
 * Module and epic grouping need the P5 data and are not offered.
 */
export function buildGanttRows<TTask extends GroupableTask>(
  tasks: readonly TTask[],
  group: "none" | "assignee",
): GanttRow<TTask>[] {
  if (group === "none") return tasks.map((task) => ({ kind: "task", task }));

  const buckets = new Map<string, { name: string | null; tasks: TTask[] }>();
  for (const task of tasks) {
    const id = task.assigneeId
      ? `gantt-group:${task.assigneeId}`
      : GANTT_UNASSIGNED_GROUP_ID;
    const bucket = buckets.get(id) ?? {
      name: task.assigneeId ? (task.assigneeName ?? null) : null,
      tasks: [],
    };
    bucket.tasks.push(task);
    buckets.set(id, bucket);
  }

  const ordered = [...buckets.entries()].sort(
    ([leftId, left], [rightId, right]) => {
      if (leftId === GANTT_UNASSIGNED_GROUP_ID) return 1;
      if (rightId === GANTT_UNASSIGNED_GROUP_ID) return -1;
      return (
        (left.name ?? "").localeCompare(right.name ?? "") ||
        leftId.localeCompare(rightId)
      );
    },
  );

  return ordered.flatMap(([id, bucket]) => [
    {
      kind: "group" as const,
      id,
      name: bucket.name,
      count: bucket.tasks.length,
    },
    ...bucket.tasks.map((task) => ({ kind: "task" as const, task })),
  ]);
}
