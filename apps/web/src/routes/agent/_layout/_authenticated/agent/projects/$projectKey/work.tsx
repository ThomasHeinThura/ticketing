import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
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
const WorkItemList = lazy(
  () => import("@/components/work-item/work-item-list"),
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
  const { sort, dir } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
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
  const { canCreateTasks, isCheckingPermissions } = useWorkspacePermission();

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
    realtimeStatus:
      realtimeStatus && realtimeStatus.projectId === project?.id
        ? realtimeStatus.status
        : "connecting",
  });
  const workItems = workItemsResult?.items;

  const isLoading =
    isWorkspaceLoading ||
    isProjectsLoading ||
    (!!project && isWorkItemsLoading);
  const isError =
    isWorkspaceError || isProjectsError || isWorkItemsError || projectNotFound;

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
    if (project) refetchWorkItems();
  }, [project, refetchProjects, refetchWorkItems]);

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
        <div
          className="flex items-center justify-between gap-3"
          data-primary-content-ready={project ? "true" : undefined}
        >
          <h1 className="font-semibold text-lg">
            {project ? project.name : projectKey} ·{" "}
            {t("workItems:list.heading")}
          </h1>
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
        <Suspense fallback={<WorkItemListLoading />}>
          <WorkItemList
            workItems={workItems}
            isLoading={isLoading}
            isError={isError}
            sort={sort}
            dir={dir}
            onSortChange={handleSortChange}
            onRetry={handleRetry}
          />
        </Suspense>
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
