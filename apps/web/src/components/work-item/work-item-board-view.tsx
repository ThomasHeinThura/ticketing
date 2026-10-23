import { Alert, AlertDescription } from "@taskdesk/ui";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { WorkItemGroup } from "@/lib/project-board-search";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";
import WorkItemBoard from "./work-item-board";
import WorkItemGroupedBoard from "./work-item-grouped-board";

const WorkItemListRealtime = lazy(
  () => import("@/components/work-item/work-item-list-realtime"),
);

/**
 * Everything the board layout needs, in one chunk: its queries, the strict capability flags,
 * realtime and the board itself. The work route loads this only for `layout=board`, so the
 * default list route's graph does not carry any of it (G11).
 *
 * `canTransition` and `canRank` come from `transitionTasks` / `rankTasks`, and selection from
 * `assignTasks` while selection mode is on. All are false while capabilities load.
 */
export default function WorkItemBoardView({
  project,
  workspaceId,
  filter,
  sort = "position",
  dir = "asc",
  group = "state",
  onErrorChange,
  realtimeProjectId,
  realtimeStatus,
  onRealtimeAvailabilityChange,
  canSelect,
  selectedKeys,
  onSelectionChange,
  onPruneSelection,
  onOpenItem,
}: {
  project: { id: string; slug?: string };
  workspaceId?: string;
  filter?: string;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  /** `VW-13`: how the columns are split; state is the original board. */
  group?: WorkItemGroup;
  onErrorChange?: (error: unknown) => void;
  realtimeProjectId: string | undefined;
  realtimeStatus:
    | { projectId: string; status: WorkItemRealtimeStatus }
    | undefined;
  onRealtimeAvailabilityChange: (
    projectId: string,
    status: WorkItemRealtimeStatus,
  ) => void;
  canSelect: boolean;
  selectedKeys: string[];
  onSelectionChange: (key: string, checked: boolean) => void;
  onPruneSelection: (present: Set<string>) => void;
  onOpenItem?: (key: string) => void;
}) {
  const { t } = useTranslation();
  const {
    canTransitionTasks,
    canRankTasks,
    canAssignTasks,
    canUpdateTasks,
    canSetPriorityTasks,
    isCheckingPermissions,
  } = useWorkspacePermission(workspaceId, project.id);
  const status =
    realtimeStatus && realtimeStatus.projectId === project.id
      ? realtimeStatus.status
      : "connecting";
  const effectiveSort = filter?.trim() && sort === "position" ? "key" : sort;
  const effectiveDir = filter?.trim() && sort === "position" ? "asc" : dir;
  const items = useGetBoardWorkItems({
    projectId: project.id,
    projectSlug: project.slug,
    workspaceId,
    filter,
    sort: effectiveSort,
    dir: effectiveDir,
    realtimeStatus: status,
  });
  const states = useGetProjectStates(project.id);
  const grouped = group === "assignee" || group === "priority";
  const workItems = useMemo(
    () => items.data?.pages.flatMap((page) => page.items),
    [items.data],
  );
  const isLoading = items.isLoading || states.isLoading;
  const isError = items.isError || states.isError;
  const { refetch: refetchItems, error: itemsError } = items;
  const { refetch: refetchStates } = states;

  useEffect(() => {
    onErrorChange?.(itemsError);
  }, [itemsError, onErrorChange]);

  // A selected item that has left the loaded set must not stay selected.
  useEffect(() => {
    if (workItems)
      onPruneSelection(
        new Set(
          workItems
            .filter((item) => !item.unavailableFields.includes("key"))
            .map((item) => item.key),
        ),
      );
  }, [workItems, onPruneSelection]);

  return (
    <>
      {status === "unavailable" ? (
        <Alert
          variant="warning"
          role="status"
          data-testid="realtime-unavailable"
        >
          <AlertDescription>
            {t("workItems:detail.realtimeUnavailable")}
          </AlertDescription>
        </Alert>
      ) : null}
      {grouped ? (
        <WorkItemGroupedBoard
          projectId={project.id}
          field={group === "priority" ? "priority" : "assignee"}
          workItems={workItems}
          peopleEnabled={!isCheckingPermissions}
          isLoading={items.isLoading}
          isError={items.isError}
          onRetry={() => {
            void refetchItems();
          }}
          hasMore={items.hasNextPage}
          isLoadingMore={items.isFetchingNextPage}
          onLoadMore={() => {
            void items.fetchNextPage();
          }}
          canSelect={canSelect}
          canAssign={
            !isCheckingPermissions && (canAssignTasks() || canUpdateTasks())
          }
          canUnassignAny={!isCheckingPermissions && canAssignTasks()}
          canUpdate={!isCheckingPermissions && canUpdateTasks()}
          canSetPriority={!isCheckingPermissions && canSetPriorityTasks()}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          onOpenItem={onOpenItem}
        />
      ) : (
        <WorkItemBoard
          projectId={project.id}
          sort={effectiveSort}
          dir={effectiveDir}
          states={states.data}
          statesError={states.isError}
          workItems={workItems}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => {
            void refetchItems();
            void refetchStates();
          }}
          hasMore={items.hasNextPage}
          isLoadingMore={items.isFetchingNextPage}
          onLoadMore={() => {
            void items.fetchNextPage();
          }}
          canSelect={canSelect}
          canTransition={!isCheckingPermissions && canTransitionTasks()}
          canRank={!isCheckingPermissions && canRankTasks()}
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          onOpenItem={onOpenItem}
        />
      )}
      {!isLoading && realtimeProjectId === project.id ? (
        <Suspense fallback={<WorkItemListLoading />}>
          <WorkItemListRealtime
            key={project.id}
            projectId={project.id}
            onAvailabilityChange={onRealtimeAvailabilityChange}
          />
        </Suspense>
      ) : null}
    </>
  );
}
