import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";
import type { WorkItem } from "@/types/work-item";

const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function compare(
  field: WorkItemSortField,
  a: WorkItem,
  b: WorkItem,
  dir: WorkItemSortDirection,
): number {
  const mult = dir === "asc" ? 1 : -1;

  switch (field) {
    case "key":
      // Numeric per-project sequence, not lexical string order (PROJ-2 before PROJ-10).
      return (a.number - b.number) * mult;
    case "title":
      return a.title.localeCompare(b.title) * mult;
    case "priority": {
      const rankA = a.priority ? (PRIORITY_RANK[a.priority] ?? 99) : 99;
      const rankB = b.priority ? (PRIORITY_RANK[b.priority] ?? 99) : 99;
      return (rankA - rankB) * mult;
    }
    case "dueDate": {
      // Items with no due date always sort last, in either direction -- the direction
      // multiplier applies only once both sides actually have a date to compare.
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return (
        (new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()) * mult
      );
    }
    default:
      return 0;
  }
}

/**
 * Client-side sort over the whole list (`get-work-items.ts`'s own comment: the API has
 * no sort/filter query parameters yet, and doesn't paginate). Pure: never mutates its
 * input. Generic over `T extends WorkItem` so it also accepts `WorkItemRow` (which adds
 * `unavailableFields` for the partial state) without losing that field on the sorted
 * output.
 */
export function sortWorkItems<T extends WorkItem>(
  workItems: T[],
  field: WorkItemSortField,
  dir: WorkItemSortDirection,
): T[] {
  return [...workItems].sort((a, b) => compare(field, a, b, dir));
}
