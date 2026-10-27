import getWorkItems from "@/fetchers/work-item/get-work-items";
import type {
  WorkItemSearchColumn,
  WorkItemSort,
  WorkItemSortDirection,
  WorkItemSortField,
} from "@/lib/routes";

/**
 * The canonical project list read (`GET /api/projects/{id}/work-items`) shared by
 * `useGetWorkItems` and the work route's boot prefetch, so both address one cache entry.
 * The fetcher is a static import: behind a dynamic import, the first page waited for its
 * one-kilobyte chunk to queue behind the whole list module graph (G11 work-list LCP).
 */
export function workItemsListQueryKey(
  projectId: string | undefined,
  sort: WorkItemSortField,
  dir: WorkItemSortDirection,
) {
  return ["work-items", projectId, "list", sort, dir] as const;
}

/** True when the list must be read through structured search instead of the project list. */
export function usesWorkItemSearch({
  filter,
  columns,
  sort,
  dir,
  sorts,
}: {
  filter?: string;
  columns?: WorkItemSearchColumn[];
  sort: WorkItemSortField;
  dir: WorkItemSortDirection;
  sorts?: WorkItemSort[];
}) {
  const effectiveSorts = sorts?.length ? sorts : [{ field: sort, order: dir }];
  return Boolean(
    filter?.trim() ||
      (columns?.some((column) => column.startsWith("cf.")) ?? false) ||
      effectiveSorts.some(
        (entry) =>
          !["key", "title", "priority", "dueDate"].includes(entry.field),
      ) ||
      effectiveSorts.length > 1,
  );
}

/** One page of the project list, in the order the route asked for. */
export function fetchWorkItemsListPage(
  projectId: string,
  sort: WorkItemSortField,
  dir: WorkItemSortDirection,
  cursor: string | undefined,
) {
  const listSort =
    sort === "key" ||
    sort === "position" ||
    sort === "title" ||
    sort === "priority" ||
    sort === "dueDate"
      ? sort
      : "key";
  return getWorkItems(projectId, listSort, dir, { cursor });
}
