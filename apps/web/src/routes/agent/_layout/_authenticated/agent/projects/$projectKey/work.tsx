import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import BulkAssignToolbar from "@/components/work-item/bulk-assign-toolbar";
import WorkItemList from "@/components/work-item/work-item-list";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

const CreateWorkItemDialog = lazy(
  () => import("@/components/work-item/create-work-item-dialog"),
);
const WorkItemListRealtime = lazy(
  () => import("@/components/work-item/work-item-list-realtime"),
);
const WorkItemBoard = lazy(
  () => import("@/components/work-item/work-item-board"),
);

import {
  parseWorkItemListSearch,
  type WorkItemListSearch,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";

/**
 * `docs/02-design/screen-inventory.md` "Work — list" (P1), the first v2 work-item
 * screen -- decision log "2026-09-23 · P1's UI path: new v2 work-item screens on the new
 * API" (PR #300). Read-only: create/edit/delete are separate, later slices.
 *
 * `{projectKey}` is the project's `slug` (`work_item.key`'s own prefix,
 * `docs/01-architecture/data-model.md`), not its id -- the API has no
 * "get project by slug" route, so this resolves it client-side from the workspace's
 * project list (the same list the sidebar/nav already fetches), matching how every
 * other v1 screen in this codebase resolves a project from its slug-shaped param.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/work",
)({
  validateSearch: parseWorkItemListSearch,
  component: WorkItemsRouteComponent,
});

function WorkItemsRouteComponent() {
  const { t } = useTranslation();
  const { projectKey } = Route.useParams();
  const { layout, sort, dir } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [realtimeProjectId, setRealtimeProjectId] = useState<string>();
  const [realtimeStatus, setRealtimeStatus] = useState<{
    projectId: string;
    status: WorkItemRealtimeStatus;
  }>();

  // Creation is gated on the same server-computed capability the app's other create UI
  // uses (`useWorkspacePermission`, backed by `GET /api/capabilities`). The v2 canonical
  // `work_item:create` signal for a UI does not exist yet -- that is #8's runtime wiring
  // -- so this is the live signal, called as a helper; the server stays the authority,
  // and a 403 from the create call is handled explicitly inside the dialog.
  const {
    canCreateTasks,
    canAssignTasks,
    canTransitionTasks,
    canRankTasks,
    isCheckingPermissions,
  } = useWorkspacePermission();

  const {
    data: workspace,
    isLoading: isWorkspaceLoading,
    isError: isWorkspaceError,
  } = useActiveWorkspace();

  const {
    data: projects,
    isLoading: isProjectsLoading,
    isError: isProjectsError,
    refetch: refetchProjects,
  } = useGetProjects({ workspaceId: workspace?.id ?? "" });

  const project = projects?.find((candidate) => candidate.slug === projectKey);
  const projectId = project?.id;
  const projectNotFound =
    !isWorkspaceLoading && !isProjectsLoading && !!projects && !project;

  const {
    data: workItemsResult,
    isLoading: isWorkItemsLoading,
    isError: isWorkItemsError,
    refetch: refetchWorkItems,
  } = useGetWorkItems({
    projectId: project?.id,
    sort,
    dir,
    enabled: layout === "list",
    realtimeStatus:
      realtimeStatus && realtimeStatus.projectId === project?.id
        ? realtimeStatus.status
        : "connecting",
  });
  const boardItemsQuery = useGetBoardWorkItems({
    projectId: project?.id,
    realtimeStatus:
      realtimeStatus && realtimeStatus.projectId === project?.id
        ? realtimeStatus.status
        : "connecting",
    enabled: layout === "board",
  });
  const projectStates = useGetProjectStates(project?.id, layout === "board");
  const boardWorkItems = boardItemsQuery.data?.pages.flatMap(
    (page) => page.items,
  );
  const workItems =
    layout === "board" ? boardWorkItems : workItemsResult?.items;

  const isLoading =
    isWorkspaceLoading ||
    isProjectsLoading ||
    (!!project &&
      (layout === "board"
        ? boardItemsQuery.isLoading || projectStates.isLoading
        : isWorkItemsLoading));
  const isError =
    isWorkspaceError ||
    isProjectsError ||
    projectNotFound ||
    (layout === "board"
      ? boardItemsQuery.isError || projectStates.isError
      : isWorkItemsError);

  useEffect(() => {
    if (!projectId || isLoading) return;
    setRealtimeProjectId(projectId);
    setRealtimeStatus({ projectId, status: "connecting" });
  }, [projectId, isLoading]);

  const handleRealtimeAvailabilityChange = useCallback(
    (projectId: string, status: WorkItemRealtimeStatus) => {
      if (projectId !== project?.id) return;
      setRealtimeStatus({ projectId, status });
    },
    [project?.id],
  );

  const handleSortChange = useCallback(
    (nextSort: WorkItemSortField, nextDir: WorkItemSortDirection) => {
      navigate({
        search: (prev: WorkItemListSearch) => ({
          ...prev,
          sort: nextSort,
          dir: nextDir,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const handleRetry = useCallback(() => {
    refetchProjects();
    if (project) {
      if (layout === "board") {
        void boardItemsQuery.refetch();
        void projectStates.refetch();
      } else {
        void refetchWorkItems();
      }
    }
  }, [
    boardItemsQuery,
    layout,
    project,
    projectStates,
    refetchProjects,
    refetchWorkItems,
  ]);

  useEffect(() => {
    if (projectKey) setSelectedKeys([]);
  }, [projectKey]);

  const canBulkAssign = !isCheckingPermissions && canAssignTasks();

  return (
    <>
      <PageTitle
        title={
          project
            ? t("workItems:list.pageTitleWithProject", {
                project: project.name,
              })
            : t("workItems:list.pageTitle")
        }
      />
      <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-semibold text-lg">
            {project ? project.name : projectKey} ·{" "}
            {t("workItems:list.heading")}
          </h1>
          <div className="flex items-center gap-2">
            <Button
              variant={layout === "board" ? "secondary" : "outline"}
              size="sm"
              aria-pressed={layout === "board"}
              onClick={() =>
                navigate({
                  search: (prev: WorkItemListSearch) => ({
                    ...prev,
                    layout: "board",
                  }),
                })
              }
            >
              {t("workItems:list.boardLayout")}
            </Button>
            <Button
              variant={layout === "list" ? "secondary" : "outline"}
              size="sm"
              aria-pressed={layout === "list"}
              onClick={() =>
                navigate({
                  search: (prev: WorkItemListSearch) => ({
                    ...prev,
                    layout: "list",
                  }),
                })
              }
            >
              {t("workItems:list.listLayout")}
            </Button>
            {project && !isCheckingPermissions && canCreateTasks() ? (
              <Button
                size="sm"
                onClick={() => setIsCreateOpen(true)}
                data-testid="create-work-item-trigger"
              >
                {t("workItems:create.trigger")}
              </Button>
            ) : null}
          </div>
        </div>
        {project &&
        realtimeStatus?.projectId === project.id &&
        realtimeStatus.status === "unavailable" ? (
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
        {layout === "list" ? (
          <WorkItemList
            workItems={workItems}
            isLoading={isLoading}
            isError={isError}
            sort={sort}
            dir={dir}
            onSortChange={handleSortChange}
            onRetry={handleRetry}
            selectedKeys={selectedKeys}
            canBulkAssign={canBulkAssign}
            onSelectionChange={(key, checked) => {
              setSelectedKeys((current) =>
                checked
                  ? current.includes(key)
                    ? current
                    : [...current, key]
                  : current.filter((selected) => selected !== key),
              );
            }}
            onSelectAll={(checked) => {
              const keys = (workItems ?? [])
                .filter((item) => !item.unavailableFields.includes("key"))
                .map((item) => item.key);
              setSelectedKeys((current) =>
                checked
                  ? [...new Set([...current, ...keys])]
                  : current.filter((key) => !keys.includes(key)),
              );
            }}
          />
        ) : project ? (
          <Suspense fallback={null}>
            <WorkItemBoard
              projectId={project.id}
              states={projectStates.data}
              statesError={projectStates.isError}
              workItems={boardWorkItems}
              isLoading={isLoading}
              isError={isError}
              onRetry={handleRetry}
              hasMore={boardItemsQuery.hasNextPage ?? false}
              isLoadingMore={boardItemsQuery.isFetchingNextPage}
              onLoadMore={() => {
                void boardItemsQuery.fetchNextPage();
              }}
              canSelect={canBulkAssign}
              canTransition={!isCheckingPermissions && canTransitionTasks()}
              canRank={!isCheckingPermissions && canRankTasks()}
              selectedKeys={selectedKeys}
              onSelectionChange={(key, checked) => {
                setSelectedKeys((current) =>
                  checked
                    ? current.includes(key)
                      ? current
                      : [...current, key]
                    : current.filter((selected) => selected !== key),
                );
              }}
            />
          </Suspense>
        ) : null}
        {project && workspace && selectedKeys.length > 0 && canBulkAssign && (
          <BulkAssignToolbar
            projectId={project.id}
            workspaceId={workspace.id}
            selectedKeys={selectedKeys}
            onAssigned={(succeeded) =>
              setSelectedKeys((current) =>
                current.filter((key) => !succeeded.includes(key)),
              )
            }
          />
        )}
        {project && !isLoading && realtimeProjectId === project.id ? (
          <Suspense fallback={null}>
            <WorkItemListRealtime
              key={project.id}
              projectId={project.id}
              onAvailabilityChange={handleRealtimeAvailabilityChange}
            />
          </Suspense>
        ) : null}
        {project && isCreateOpen ? (
          <Suspense fallback={null}>
            <CreateWorkItemDialog
              open
              onClose={() => setIsCreateOpen(false)}
              projectId={project.id}
              workspaceId={workspace?.id}
            />
          </Suspense>
        ) : null}
      </div>
    </>
  );
}
