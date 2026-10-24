/** The task fields the timeline needs to group rows. Kept minimal so the helper stays pure. */
type GroupableTask = {
  id: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  moduleId?: string | null;
};

export type GanttGroupBy = "none" | "assignee" | "module";

export type GanttRow<TTask extends GroupableTask> =
  | { kind: "task"; task: TTask }
  | {
      kind: "group";
      id: string;
      /** What the heading groups by, so the empty bucket reads as "Unassigned" or "No module". */
      by: "assignee" | "module";
      /** The assignee's or module's name; `null` is the empty bucket. */
      name: string | null;
      count: number;
    };

export const GANTT_UNASSIGNED_GROUP_ID = "gantt-group:none";

/**
 * `VW-27`: the timeline's rows, optionally grouped by assignee or module. Each group is a heading
 * row followed by that bucket's bars in the order they arrived (start date), buckets sorted by
 * name, the empty bucket (unassigned, no module) last. Without a grouping the rows are the tasks,
 * untouched. Module grouping resolves names from `moduleNames`; a module id with no known name
 * keeps its own heading rather than merging into "No module". Epic grouping is not offered.
 */
export function buildGanttRows<TTask extends GroupableTask>(
  tasks: readonly TTask[],
  group: GanttGroupBy,
  moduleNames: ReadonlyMap<string, string> = new Map(),
): GanttRow<TTask>[] {
  if (group === "none") return tasks.map((task) => ({ kind: "task", task }));

  const buckets = new Map<string, { name: string | null; tasks: TTask[] }>();
  for (const task of tasks) {
    const key = group === "assignee" ? task.assigneeId : task.moduleId;
    const id = key ? `gantt-group:${key}` : GANTT_UNASSIGNED_GROUP_ID;
    const bucket = buckets.get(id) ?? {
      name: key
        ? group === "assignee"
          ? (task.assigneeName ?? null)
          : (moduleNames.get(key) ?? null)
        : null,
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
      by: group,
      name: bucket.name,
      count: bucket.tasks.length,
    },
    ...bucket.tasks.map((task) => ({ kind: "task" as const, task })),
  ]);
}
