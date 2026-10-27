import { useQueries } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import { Alert, AlertDescription } from "@taskdesk/ui";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import type { WorkItemAgileScope } from "@/fetchers/work-item/get-work-items";
import useWipLimits from "@/hooks/queries/agile/use-wip-limits";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import useGetCombinedBoardWorkItems from "@/hooks/queries/work-item/use-get-combined-board-work-items";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import type { WorkItemGroup } from "@/lib/project-board-search";
import type { WorkItemSortDirection, WorkItemSortField } from "@/lib/routes";
import type {
  CustomFieldGroupDefinition,
  WorkItemBoardGroupField,
} from "@/lib/work-item-board-groups";
import type { WorkItemSearchColumn } from "@/lib/work-item-list-search";
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
  customField,
  onErrorChange,
  realtimeProjectId,
  realtimeStatus,
  onRealtimeAvailabilityChange,
  canSelect,
  selectedKeys,
  onSelectionChange,
  onPruneSelection,
  onOpenItem,
  scope,
  combined = false,
  onCreateInState,
}: {
  project: { id: string; slug?: string };
  /** P5 agile: show only the members of one cycle or module. */
  scope?: WorkItemAgileScope;
  combined?: boolean;
  workspaceId?: string;
  filter?: string;
  sort?: WorkItemSortField;
  dir?: WorkItemSortDirection;
  /** `VW-13`: how the columns are split; state is the original board. */
  group?: WorkItemGroup;
  customField?: CustomFieldGroupDefinition;
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
  /** Kaneo's per-column "+": opens the create dialog for one state column. */
  onCreateInState?: (
    state: { id: string; name: string },
    trigger: HTMLButtonElement,
  ) => void;
}) {
  const { t } = useTranslation();
  const {
    canCreateTasks,
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
    columns:
      group.startsWith("cf.") && customField?.key === group.slice(3)
        ? ([`cf.${customField.key}`] as WorkItemSearchColumn[])
        : undefined,
    sort: effectiveSort,
    dir: effectiveDir,
    realtimeStatus: status,
    scope,
    enabled: !combined,
  });
  const combinedItems = useGetCombinedBoardWorkItems({
    projectId: project.id,
    workspaceId,
    filter,
    sort: effectiveSort,
    dir: effectiveDir,
    enabled: combined,
  });
  const states = useGetProjectStates(project.id, !combined);
  const wipLimits = useWipLimits(combined ? undefined : project.slug);
  const grouped = group !== "state";
  const combinedPages = combinedItems.data?.pages;
  const combinedRows = useMemo(
    () => combinedPages?.flatMap((page) => page.items),
    [combinedPages],
  );
  const combinedColumns = useMemo(
    () =>
      combinedPages?.[0]?.columns.map((column) => ({
        id: column.templateId,
        name: column.name,
        group: column.group,
      })),
    [combinedPages],
  );
  const sourceProjectIds = useMemo(
    () =>
      [
        ...new Set((combinedRows ?? []).map((item) => item.sourceProject.id)),
      ].sort(),
    [combinedRows],
  );
  const capabilityQueries = useQueries({
    queries: sourceProjectIds.map((sourceProjectId) => ({
      queryKey: [
        "workspace-capabilities",
        workspaceId,
        "work-item-target",
        sourceProjectId,
      ],
      enabled: Boolean(combined && workspaceId),
      staleTime: 5 * 60 * 1000,
      queryFn: async () => {
        const response = await client.capabilities.$get({
          query: {
            workspaceId: workspaceId as string,
            projectId: sourceProjectId,
          },
        });
        if (!response.ok) throw new Error("Failed to get project capabilities");
        return response.json();
      },
    })),
  });
  const combinedCapabilities = useMemo(() => {
    const result = new Map<
      string,
      { canRank: boolean; canTransition: boolean; canBulkAct: boolean }
    >();
    sourceProjectIds.forEach((sourceProjectId, index) => {
      const query = capabilityQueries[index];
      const capabilities = query?.data;
      const ready =
        Boolean(capabilities) &&
        !query?.isPending &&
        !query?.isFetching &&
        !query?.isError;
      result.set(sourceProjectId, {
        canRank: ready && capabilities?.rankTasks === true,
        canTransition: ready && capabilities?.transitionTasks === true,
        canBulkAct:
          ready &&
          (capabilities?.assignTasks === true ||
            capabilities?.updateTasks === true ||
            capabilities?.setPriorityTasks === true ||
            capabilities?.transitionTasks === true ||
            capabilities?.deleteTasks === true),
      });
    });
    return result;
  }, [capabilityQueries, sourceProjectIds]);
  const combinedCanTransition = [...combinedCapabilities.values()].some(
    (capabilities) => capabilities.canTransition,
  );
  const combinedCanRank = [...combinedCapabilities.values()].some(
    (capabilities) => capabilities.canRank,
  );
  const workItems = useMemo(
    () => items.data?.pages.flatMap((page) => page.items),
    [items.data],
  );
  const visibleWorkItems = combined ? combinedRows : workItems;
  const visibleStates = combined ? combinedColumns : states.data;
  const visibleIsLoading = combined
    ? combinedItems.isLoading
    : items.isLoading || states.isLoading;
  const visibleIsError = combined
    ? combinedItems.isError
    : items.isError || states.isError;
  const isLoading = visibleIsLoading || (combined && !combinedColumns);
  const isError = visibleIsError;
  const { refetch: refetchItems, error: itemsError } = items;
  const { refetch: refetchStates } = states;

  useEffect(() => {
    onErrorChange?.(combined ? combinedItems.error : itemsError);
  }, [combined, combinedItems.error, itemsError, onErrorChange]);

  // A selected item that has left the loaded set must not stay selected.
  useEffect(() => {
    if (visibleWorkItems)
      onPruneSelection(
        new Set(
          visibleWorkItems
            .filter((item) => !item.unavailableFields.includes("key"))
            .map((item) => item.key),
        ),
      );
  }, [visibleWorkItems, onPruneSelection]);

  return (
    <>
      {!combined && status === "unavailable" ? (
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
          field={group as WorkItemBoardGroupField}
          customField={customField}
          customFieldPeople={
            items.data?.pages.flatMap((page) => page.customFieldPeople ?? []) ??
            []
          }
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
          wipLimits={combined ? undefined : wipLimits.limits}
          states={visibleStates}
          statesError={combined ? false : states.isError}
          workItems={visibleWorkItems}
          isLoading={isLoading}
          isError={isError}
          onRetry={() => {
            if (combined) void combinedItems.refetch();
            else {
              void refetchItems();
              void refetchStates();
            }
          }}
          hasMore={combined ? combinedItems.hasNextPage : items.hasNextPage}
          isLoadingMore={
            combined
              ? combinedItems.isFetchingNextPage
              : items.isFetchingNextPage
          }
          onLoadMore={() => {
            if (combined) void combinedItems.fetchNextPage();
            else void items.fetchNextPage();
          }}
          canSelect={canSelect}
          canTransition={
            combined
              ? combinedCanTransition
              : !isCheckingPermissions && canTransitionTasks()
          }
          canRank={
            combined
              ? combinedCanRank
              : !isCheckingPermissions && canRankTasks()
          }
          selectedKeys={selectedKeys}
          onSelectionChange={onSelectionChange}
          onOpenItem={onOpenItem}
          combinedColumns={combined ? combinedPages?.[0]?.columns : undefined}
          combinedCapabilities={combined ? combinedCapabilities : undefined}
          onCreateInState={
            !combined && !isCheckingPermissions && canCreateTasks()
              ? onCreateInState
              : undefined
          }
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
