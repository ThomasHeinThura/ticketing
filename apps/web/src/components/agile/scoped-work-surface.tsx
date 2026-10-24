import { useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useMemo, useState } from "react";
import { ScopedMembershipContext } from "@/components/agile/scoped-membership-context";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import type { WorkItemAgileScope } from "@/fetchers/work-item/get-work-items";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import {
  routes,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";

const WorkItemBoardView = lazy(
  () => import("@/components/work-item/work-item-board-view"),
);
const WorkItemKaneoList = lazy(
  () => import("@/components/work-item/work-item-kaneo-list"),
);

const NO_OP = () => {};

function ScopedList({
  project,
  workspaceId,
  scope,
}: {
  project: { id: string; slug: string };
  workspaceId: string;
  scope: WorkItemAgileScope;
}) {
  const navigate = useNavigate();
  const [sort, setSort] = useState<WorkItemSortField>("key");
  const [dir, setDir] = useState<WorkItemSortDirection>("asc");
  const items = useGetBoardWorkItems({
    projectId: project.id,
    projectSlug: project.slug,
    workspaceId,
    sort,
    dir,
    realtimeStatus: "connecting",
    scope,
  });
  const workItems = useMemo(
    () => items.data?.pages.flatMap((page) => page.items),
    [items.data],
  );
  return (
    <WorkItemKaneoList
      projectId={project.id}
      workspaceId={workspaceId}
      workItems={workItems}
      hasPartialFailure={
        items.data?.pages.some((page) => page.hasPartialFailure) ?? false
      }
      isLoading={items.isLoading}
      isError={items.isError}
      sort={sort}
      dir={dir}
      onSortChange={(nextSort, nextDir) => {
        setSort(nextSort);
        setDir(nextDir);
      }}
      onRetry={() => {
        void items.refetch();
      }}
      hasMore={items.hasNextPage}
      onLoadMore={() => {
        void items.fetchNextPage();
      }}
      isLoadingMore={items.isFetchingNextPage}
      onOpenItem={(key) =>
        void navigate({ href: routes.workItemDetail.build({ key }) })
      }
    />
  );
}

/**
 * The cycle or module "work surface": the project's own Kaneo board or list, fed by the work
 * item list narrowed to the members (`cycle=` / `module=`). It is the normal work surface, not a
 * lesser board, so drag, transitions and ranking behave as everywhere else.
 */
export function ScopedWorkSurface({
  project,
  workspaceId,
  scope,
  layout,
  canEditItems = false,
}: {
  project: { id: string; slug: string };
  workspaceId: string;
  scope: WorkItemAgileScope;
  layout: "board" | "list";
  /** The caller may update work items: enables "Remove from cycle / module" on each row. */
  canEditItems?: boolean;
}) {
  const navigate = useNavigate();
  const membership = scope.cycleId
    ? { kind: "cycle" as const, id: scope.cycleId, canEdit: canEditItems }
    : scope.moduleId
      ? { kind: "module" as const, id: scope.moduleId, canEdit: canEditItems }
      : undefined;
  return (
    <ScopedMembershipContext.Provider value={membership}>
      <Suspense fallback={<WorkItemListLoading />}>
        {layout === "list" ? (
          <ScopedList
            project={project}
            workspaceId={workspaceId}
            scope={scope}
          />
        ) : (
          <WorkItemBoardView
            project={project}
            workspaceId={workspaceId}
            scope={scope}
            realtimeProjectId={undefined}
            realtimeStatus={undefined}
            onRealtimeAvailabilityChange={NO_OP}
            canSelect={false}
            selectedKeys={[]}
            onSelectionChange={NO_OP}
            onPruneSelection={NO_OP}
            onOpenItem={(key) =>
              void navigate({ href: routes.workItemDetail.build({ key }) })
            }
          />
        )}
      </Suspense>
    </ScopedMembershipContext.Provider>
  );
}
