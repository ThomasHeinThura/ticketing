import type { QueryClient } from "@tanstack/react-query";
import getProjectStates from "@/fetchers/project/get-project-states";
import getProjects from "@/fetchers/project/get-projects";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import getWorkItems from "@/fetchers/work-item/get-work-items";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";
import {
  fetchWorkItemsListPage,
  usesWorkItemSearch,
  workItemsListQueryKey,
} from "@/hooks/queries/work-item/work-items-list-query";
import type { WorkItemWorkSearch } from "@/lib/routes";
import { getActiveOrganizationId } from "@/lib/session-active-organization-id";

/**
 * Starts the work list's reads from the route's `beforeLoad` (G11 work-list LCP): the main
 * entry preloads the route on a direct visit, so on a signed-in session the workspace and
 * project lists, the first work-item page and the project states are requested before React
 * mounts the screen, instead of one after another behind the screen's lazy modules.
 *
 * Every read uses the exact query key and fetcher of the hook that renders it
 * (`useGetWorkspaces`, `useGetProjects`, `useGetWorkItems`, `useGetProjectStates`), so the
 * screen reads these entries rather than fetching again, and permission checks stay with the
 * API. `ensure*` never refetches cached data, so re-entering the route costs nothing. Errors are
 * left to the hooks, which surface them in the screen.
 */
export function prefetchWorkListData(
  queryClient: QueryClient,
  {
    session,
    projectKey,
    search,
  }: {
    session: { session?: unknown } | null | undefined;
    projectKey: string;
    search: WorkItemWorkSearch;
  },
) {
  const workspaceId = getActiveOrganizationId(session);
  if (!workspaceId) return;
  // The table reads the same first page; the grouped list and the board also need the states.
  const board = search.layout === "board" ? boardRead(search) : undefined;
  if (search.layout !== "list" && search.layout !== "table" && !board) return;
  void (async () => {
    const projectsPromise = queryClient.ensureQueryData({
      queryKey: ["projects", workspaceId, undefined, undefined],
      queryFn: () =>
        getProjects({
          workspaceId,
          includeArchived: undefined,
          includeDeleted: undefined,
        }),
    });
    void queryClient.ensureQueryData({
      queryKey: ["workspaces"],
      queryFn: getWorkspaces,
    });
    const projects = await projectsPromise;
    const project = projects?.find(
      (candidate) => candidate.slug === projectKey,
    );
    if (!project) return;
    const reads: Promise<unknown>[] = [];
    if (search.layout === "list" || board)
      reads.push(
        queryClient.ensureQueryData({
          queryKey: ["projects", project.id, "states"],
          queryFn: () => getProjectStates(project.id),
        }),
      );
    if (board)
      reads.push(
        queryClient.ensureInfiniteQueryData({
          queryKey: ["work-items", project.id, "board", board.sort, board.dir],
          initialPageParam: undefined as string | undefined,
          getNextPageParam: (lastPage: WorkItemsResult) =>
            lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
          queryFn: ({ pageParam }) =>
            getWorkItems(project.id, board.listSort, board.dir, {
              cursor: pageParam,
              limit: BOARD_PAGE_SIZE,
            }),
        }),
      );
    else if (!usesWorkItemSearch(search))
      reads.push(
        queryClient.ensureInfiniteQueryData({
          queryKey: workItemsListQueryKey(project.id, search.sort, search.dir),
          initialPageParam: undefined as string | undefined,
          queryFn: ({ pageParam }) =>
            fetchWorkItemsListPage(
              project.id,
              search.sort,
              search.dir,
              pageParam,
            ),
        }),
      );
    await Promise.all(reads);
  })().catch(() => undefined);
}

/** `useGetBoardWorkItems`'s page size: the board's first page holds up to 200 cards. */
const BOARD_PAGE_SIZE = 200;

/**
 * The board's first page as `WorkItemBoardView` reads it through `useGetBoardWorkItems` (same
 * key, fetcher and page size), for the plain state-grouped board only. A filter, a combined
 * (descendants) board or a custom-field grouping read through other queries, so they are left
 * to the screen.
 */
function boardRead(search: WorkItemWorkSearch) {
  if (
    search.filter?.trim() ||
    search.combined ||
    search.group?.startsWith("cf.")
  )
    return undefined;
  const listSort =
    search.sort === "key" ||
    search.sort === "position" ||
    search.sort === "title" ||
    search.sort === "priority" ||
    search.sort === "dueDate"
      ? search.sort
      : "key";
  return { sort: search.sort, dir: search.dir, listSort };
}
