import type { WorkItemPriority, WorkItemRow } from "@/types/work-item";

/** `VW-13`: the board's non-state groupings. State is the original board and is not here. */
export type WorkItemBoardGroupField = "assignee" | "priority";

export type WorkItemBoardGroup = {
  /** Prefixed so a group droppable can never collide with a state or work-item id. */
  id: string;
  field: WorkItemBoardGroupField;
  /** The person id or priority the group stands for; `null` is the empty bucket. */
  value: string | null;
  /** The person's name for an assignee group; priorities are named by the view. */
  name: string | null;
  /** False for a group the person cannot be moved into (not assignable on this project). */
  droppable: boolean;
  items: WorkItemRow[];
};

export type AssignablePerson = { personId: string; name: string | null };

export const PRIORITY_GROUP_ORDER: readonly WorkItemPriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
];

export function boardGroupId(
  field: WorkItemBoardGroupField,
  value: string | null,
): string {
  return `group:${field}:${value ?? "none"}`;
}

/** The field and value a group id stands for, or undefined for any other droppable id. */
export function parseBoardGroupId(
  id: unknown,
): { field: WorkItemBoardGroupField; value: string | null } | undefined {
  if (typeof id !== "string") return undefined;
  const match = /^group:(assignee|priority):(.+)$/u.exec(id);
  if (!match) return undefined;
  const field = match[1] as WorkItemBoardGroupField;
  return { field, value: match[2] === "none" ? null : match[2] };
}

/** The group a row sits in right now. */
export function itemGroupValue(
  item: Pick<WorkItemRow, "assigneeId" | "priority">,
  field: WorkItemBoardGroupField,
): string | null {
  return field === "assignee" ? item.assigneeId : item.priority;
}

/**
 * Splits the loaded rows into one column per group, keeping the API's own order inside each
 * (a non-rank order must survive "Load more"). Assignee columns are the project's assignable
 * people, so a drop target exists for someone with no card yet; a loaded assignee who is no
 * longer assignable still gets a column, but it is not a drop target. The empty bucket always
 * comes first for assignees and last for priorities, and is always present so an item can be
 * cleared.
 */
export function buildBoardGroups(
  field: WorkItemBoardGroupField,
  items: readonly WorkItemRow[],
  people: readonly AssignablePerson[] = [],
): WorkItemBoardGroup[] {
  const byValue = new Map<string | null, WorkItemRow[]>();
  for (const item of items) {
    const value = itemGroupValue(item, field);
    const bucket = byValue.get(value) ?? [];
    bucket.push(item);
    byValue.set(value, bucket);
  }

  if (field === "priority") {
    const known = new Set<string>(PRIORITY_GROUP_ORDER);
    const values: (string | null)[] = [...PRIORITY_GROUP_ORDER, null];
    // A priority the client does not know is kept visible rather than dropped.
    for (const value of byValue.keys())
      if (value !== null && !known.has(value)) values.push(value);
    return values.map((value) => ({
      id: boardGroupId("priority", value),
      field: "priority",
      value,
      name: null,
      droppable: value === null || known.has(value),
      items: byValue.get(value) ?? [],
    }));
  }

  const groups: WorkItemBoardGroup[] = [
    {
      id: boardGroupId("assignee", null),
      field: "assignee",
      value: null,
      name: null,
      droppable: true,
      items: byValue.get(null) ?? [],
    },
  ];
  const seen = new Set<string>();
  for (const person of people) {
    if (seen.has(person.personId)) continue;
    seen.add(person.personId);
    groups.push({
      id: boardGroupId("assignee", person.personId),
      field: "assignee",
      value: person.personId,
      name: person.name,
      droppable: true,
      items: byValue.get(person.personId) ?? [],
    });
  }
  for (const [value, bucket] of byValue) {
    if (value === null || seen.has(value)) continue;
    groups.push({
      id: boardGroupId("assignee", value),
      field: "assignee",
      value,
      name: bucket[0]?.assigneeName ?? null,
      droppable: false,
      items: bucket,
    });
  }
  return groups;
}
