import { Alert, AlertDescription } from "@taskdesk/ui";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import WorkItemBoard from "./work-item-board";

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
  realtimeProjectId,
  realtimeStatus,
  onRealtimeAvailabilityChange,
  canSelect,
  selectedKeys,
  onSelectionChange,
  onPruneSelection,
}: {
  project: { id: string };
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
}) {
  const { t } = useTranslation();
  const { canTransitionTasks, canRankTasks, isCheckingPermissions } =
    useWorkspacePermission();
  const status =
    realtimeStatus && realtimeStatus.projectId === project.id
      ? realtimeStatus.status
      : "connecting";
  const items = useGetBoardWorkItems({
    projectId: project.id,
    realtimeStatus: status,
  });
  const states = useGetProjectStates(project.id);
  const workItems = useMemo(
    () => items.data?.pages.flatMap((page) => page.items),
    [items.data],
  );
  const isLoading = items.isLoading || states.isLoading;
  const isError = items.isError || states.isError;
  const { refetch: refetchItems } = items;
  const { refetch: refetchStates } = states;

  // A selected item that has left the loaded set must not stay selected.
  useEffect(() => {
    if (workItems) onPruneSelection(new Set(workItems.map((item) => item.key)));
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
      <WorkItemBoard
        projectId={project.id}
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
      />
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
