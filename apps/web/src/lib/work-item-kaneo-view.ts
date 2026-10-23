import { getTaskItemStats } from "@/lib/get-task-item-stats";
import type Task from "@/types/task";
import { extractDescription, type WorkItemRow } from "@/types/work-item";

/** Presentation only. Canonical writes retain the original decimal rank and person ID. */
export function workItemKaneoView(item: WorkItemRow): Task {
  const description = extractDescription(item.description);
  return {
    id: item.id,
    title: item.title,
    number: item.number,
    description: description.kind === "text" ? description.text : null,
    labels: item.labels?.map(({ id, name, color }) => ({ id, name, color })),
    taskItemStats: canonicalTaskItemStats(item.description),
    status: item.stateId,
    priority: item.priority,
    startDate: item.startDate,
    dueDate: item.dueDate,
    position: null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    version: item.version,
    userId: null,
    assigneeId: item.assigneeId,
    assigneeName: item.assigneeName,
    projectId: item.projectId,
  };
}

export function workItemProjectSlug(
  item: Pick<WorkItemRow, "key" | "number">,
): string {
  return item.key.slice(0, -(String(item.number).length + 1));
}

/** Read checklist nodes, not checkbox-looking prose or flattened rich text. */
export function canonicalTaskItemStats(
  description: unknown,
): Task["taskItemStats"] {
  if (
    description === null ||
    description === undefined ||
    typeof description === "string"
  )
    return getTaskItemStats(description ?? null);
  if (
    !description ||
    typeof description !== "object" ||
    Array.isArray(description) ||
    (description as Record<string, unknown>).type !== "doc"
  )
    return null;
  const pending: { node: unknown; parent: string | undefined }[] = [
    { node: description, parent: undefined },
  ];
  const seen = new WeakSet<object>();
  let total = 0;
  let completed = 0;
  let visited = 0;
  while (pending.length) {
    if (++visited > 10000) return null;
    const entry = pending.pop();
    const node = entry?.node;
    if (
      !node ||
      typeof node !== "object" ||
      Array.isArray(node) ||
      seen.has(node)
    )
      return null;
    seen.add(node);
    const record = node as Record<string, unknown>;
    if (typeof record.type !== "string") return null;
    if (record.type === "codeBlock" || record.type === "text") continue;
    if (record.type === "taskItem") {
      const attrs = record.attrs;
      if (
        entry?.parent !== "taskList" ||
        !attrs ||
        typeof attrs !== "object" ||
        Array.isArray(attrs) ||
        typeof (attrs as Record<string, unknown>).checked !== "boolean"
      )
        return null;
      total++;
      if ((attrs as Record<string, unknown>).checked === true) completed++;
    }
    if (record.content !== undefined) {
      if (
        !Array.isArray(record.content) ||
        pending.length + record.content.length > 10000
      )
        return null;
      for (const child of record.content)
        pending.push({ node: child, parent: record.type });
    }
  }
  return { total, completed };
}
