import type { ListWorkItemsQuery } from "./schema";
import {
  type SearchFilter,
  validateWorkItemSearchQuery,
  type WorkItemSearchQuery,
} from "./search/query";

export type CombinedLegacyListFilters = {
  /** Exact project-local state IDs from the existing list contract. */
  state?: string;
  /** `none` and explicit person IDs cannot be represented by `assignee:@me`. */
  assignee?: string;
  cycle?: string;
  module?: string;
};

/** Convert the existing project-list URL contract without dropping its filters. */
export function adaptCombinedWorkItemListQuery(query: ListWorkItemsQuery): {
  query: WorkItemSearchQuery;
  legacyFilters: CombinedLegacyListFilters;
} {
  const filters: SearchFilter[] = [];
  if (query.priority) {
    const priorities = [...new Set(query.priority.split(","))];
    filters.push(
      priorities.length === 1
        ? { field: "priority", op: "eq", value: priorities[0] }
        : { field: "priority", op: "in", value: priorities },
    );
  }
  if (query.due_before) {
    filters.push({
      field: "dueDate",
      op: "lt",
      value: query.due_before,
    });
  }
  // Zod supplies the existing route's default `active`, so the combined board has the
  // same lifecycle default and explicit archive/deletion behavior as the ordinary list.
  filters.push({ field: "lifecycle", op: "eq", value: query.lifecycle });
  if (query.assignee === "me") {
    filters.push({ field: "assignee", op: "eq", value: "@me" });
  }

  const adapted = validateWorkItemSearchQuery({
    entity: "work_item",
    filter: filters.length === 1 ? filters[0] : { op: "and", clauses: filters },
    sort: [
      {
        field: query.sort ?? "key",
        order: query.dir ?? "asc",
      },
    ],
  });

  return {
    query: adapted,
    legacyFilters: {
      ...(query.state ? { state: query.state } : {}),
      ...(query.assignee && query.assignee !== "me"
        ? { assignee: query.assignee }
        : {}),
      ...(query.cycle ? { cycle: query.cycle } : {}),
      ...(query.module ? { module: query.module } : {}),
    },
  };
}
