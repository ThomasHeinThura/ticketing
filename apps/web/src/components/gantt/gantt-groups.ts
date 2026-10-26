/** The task fields the timeline needs to group rows. Kept minimal so the helper stays pure. */
type GroupableTask = {
  id: string;
  assigneeId?: string | null;
  assigneeName?: string | null;
  moduleId?: string | null;
  /** Server-resolved using configured work-item types and the complete parent chain. */
  epic?: { id: string; key: string; title: string } | null;
  /** False when ancestry exists but its epic cannot safely be exposed. */
  epicAvailable?: boolean;
};

export type GanttGroupBy = "none" | "assignee" | "module" | "epic";

export type GanttRow<TTask extends GroupableTask> =
  | { kind: "task"; task: TTask }
  | {
      kind: "group";
      id: string;
      /** What the heading groups by, so the empty bucket reads as "Unassigned" or "No module". */
      by: "assignee" | "module" | "epic";
      /** The assignee's or module's name; `null` is the empty bucket. */
      name: string | null;
      count: number;
      unavailable?: boolean;
    };

export const GANTT_UNASSIGNED_GROUP_ID = "gantt-group:none";

/**
 * `VW-27`: the timeline's rows, optionally grouped by assignee, module, or epic. Each group is a heading
 * row followed by that bucket's bars in the order they arrived (start date), buckets sorted by
 * name, the empty bucket (unassigned, no module, no epic) last. Without a grouping the rows are the tasks,
 * untouched. Module grouping resolves names from `moduleNames`; a module id with no known name
 * keeps its own heading rather than merging into "No module". Epic membership and availability
 * are resolved by the server; unavailable ancestry stays distinct from a genuine no-epic bucket.
 */
export function buildGanttRows<TTask extends GroupableTask>(
  tasks: readonly TTask[],
  group: GanttGroupBy,
  moduleNames: ReadonlyMap<string, string> = new Map(),
): GanttRow<TTask>[] {
  if (group === "none") return tasks.map((task) => ({ kind: "task", task }));

  const buckets = new Map<
    string,
    { name: string | null; tasks: TTask[]; unavailable?: boolean }
  >();
  for (const task of tasks) {
    const key =
      group === "assignee"
        ? task.assigneeId
        : group === "module"
          ? task.moduleId
          : task.epic?.id;
    const unavailable = group === "epic" && task.epicAvailable !== true;
    const id = unavailable
      ? "gantt-group:epic:unavailable"
      : key
        ? group === "epic"
          ? `gantt-group:epic:${key}`
          : `gantt-group:${key}`
        : GANTT_UNASSIGNED_GROUP_ID;
    const bucket = buckets.get(id) ?? {
      name: unavailable
        ? null
        : key
          ? group === "assignee"
            ? (task.assigneeName ?? null)
            : group === "module"
              ? (moduleNames.get(key) ?? null)
              : (task.epic?.title ?? null)
          : null,
      unavailable,
      tasks: [] as TTask[],
    };
    bucket.tasks.push(task);
    buckets.set(id, bucket);
  }

  const ordered = [...buckets.entries()].sort(
    ([leftId, left], [rightId, right]) => {
      if (leftId === GANTT_UNASSIGNED_GROUP_ID) return 1;
      if (rightId === GANTT_UNASSIGNED_GROUP_ID) return -1;
      if (leftId === "gantt-group:epic:unavailable") return 1;
      if (rightId === "gantt-group:epic:unavailable") return -1;
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
      ...(bucket.unavailable ? { unavailable: true } : {}),
    },
    ...bucket.tasks.map((task) => ({ kind: "task" as const, task })),
  ]);
}
