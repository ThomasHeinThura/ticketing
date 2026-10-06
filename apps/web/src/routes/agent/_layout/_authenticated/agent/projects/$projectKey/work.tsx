import { createFileRoute } from "@tanstack/react-router";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
} from "@taskdesk/ui";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";

const WorkItemsPanel = lazy(
  () => import("@/components/work-item/work-items-panel"),
);
const WorkItemCreateTrigger = lazy(
  () => import("@/components/work-item/work-item-create-trigger"),
);
type CreateWorkItemDialogModule =
  typeof import("@/components/work-item/create-work-item-dialog");

let createWorkItemDialogModulePromise:
  | Promise<CreateWorkItemDialogModule>
  | undefined;

function loadCreateWorkItemDialog(): Promise<CreateWorkItemDialogModule> {
  if (!createWorkItemDialogModulePromise) {
    createWorkItemDialogModulePromise = import(
      "@/components/work-item/create-work-item-dialog"
    ).catch((error: unknown) => {
      createWorkItemDialogModulePromise = undefined;
      throw error;
    });
  }
  return createWorkItemDialogModulePromise;
}

const CreateWorkItemDialogContent = lazy(async () => {
  const module = await loadCreateWorkItemDialog();
  return { default: module.CreateWorkItemDialogContent };
});

import {
  parseWorkItemListSearch,
  type WorkItemListSearch,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";

function preloadCreateWorkItemDialog() {
  void loadCreateWorkItemDialog().catch(() => undefined);
}

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
  const { sort, dir, filter } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState(filter ?? "");
  const [isCreateDialogReady, setIsCreateDialogReady] = useState(false);
  const [isCreateDialogLoadError, setIsCreateDialogLoadError] = useState(false);
  const [realtimeProjectId, setRealtimeProjectId] = useState<string>();
  const [realtimeStatus, setRealtimeStatus] = useState<{
    projectId: string;
    status: WorkItemRealtimeStatus;
  }>();
  const closeCreateDialog = useCallback(() => setIsCreateOpen(false), []);
  const openCreateDialog = useCallback(() => {
    setIsCreateOpen(true);
    setIsCreateDialogReady(false);
    setIsCreateDialogLoadError(false);

    void (async () => {
      try {
        await loadCreateWorkItemDialog();
        setIsCreateDialogReady(true);
      } catch {
        setIsCreateDialogLoadError(true);
      }
    })();
  }, []);

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
  const projectNotFound =
    !isWorkspaceLoading && !isProjectsLoading && !!projects && !project;

  const {
    data: workItemsResult,
    isLoading: isWorkItemsLoading,
    isError: isWorkItemsError,
    refetch: refetchWorkItems,
  } = useGetWorkItems({
    projectId: project?.id,
    projectSlug: project?.slug,
    workspaceId: workspace?.id,
    filter,
    sort,
    dir,
    realtimeStatus:
      realtimeStatus && realtimeStatus.projectId === project?.id
        ? realtimeStatus.status
        : "connecting",
  });

  useEffect(() => setFilterDraft(filter ?? ""), [filter]);
  const isLoading =
    isWorkspaceLoading ||
    isProjectsLoading ||
    (!!project && isWorkItemsLoading);
  const isError =
    isWorkspaceError || isProjectsError || isWorkItemsError || projectNotFound;

  useEffect(() => {
    if (!project?.id) return;
    setRealtimeProjectId(project.id);
    setRealtimeStatus({ projectId: project.id, status: "connecting" });
  }, [project?.id]);

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

  const handleRetryProjects = useCallback(() => {
    refetchProjects();
  }, [refetchProjects]);

  const handleRetry = useCallback(() => {
    handleRetryProjects();
    if (project) refetchWorkItems();
  }, [handleRetryProjects, project, refetchWorkItems]);

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
          {project ? (
            <Suspense fallback={null}>
              <WorkItemCreateTrigger
                onPreload={preloadCreateWorkItemDialog}
                onClick={openCreateDialog}
              />
            </Suspense>
          ) : null}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            navigate({
              search: (prev: WorkItemListSearch) => ({
                ...prev,
                ...(filterDraft.trim()
                  ? { filter: filterDraft.trim() }
                  : { filter: undefined }),
              }),
              replace: true,
            });
          }}
        >
          <Input
            aria-label={t("workItems:list.searchLabel", "Filter work items")}
            placeholder="assignee:@me state:started OR priority:>=high"
            value={filterDraft}
            maxLength={8192}
            onChange={(event) => setFilterDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline">
            {t("workItems:list.searchAction", "Filter")}
          </Button>
        </form>
        <Suspense fallback={<WorkItemListLoading />}>
          <WorkItemsPanel
            project={project}
            workItemsResult={workItemsResult as WorkItemsResult | undefined}
            isLoading={isLoading}
            isError={isError}
            realtimeProjectId={realtimeProjectId}
            realtimeStatus={realtimeStatus}
            sort={sort}
            dir={dir}
            onSortChange={handleSortChange}
            onRealtimeAvailabilityChange={handleRealtimeAvailabilityChange}
            onRetry={handleRetry}
          />
        </Suspense>
        {project && isCreateOpen ? (
          <Dialog
            open
            onOpenChange={(next) => {
              if (!next) closeCreateDialog();
            }}
          >
            <DialogContent
              className="max-w-md"
              showCloseButton
              closeLabel={t("workItems:create.close")}
              data-testid="create-work-item-dialog"
            >
              <DialogHeader>
                <DialogTitle>{t("workItems:create.title")}</DialogTitle>
                <DialogDescription>
                  {t("workItems:create.description")}
                </DialogDescription>
              </DialogHeader>
              {isCreateDialogLoadError ? (
                <div role="alert">
                  <p>{t("common:error.title")}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.location.reload()}
                  >
                    {t("common:actions.tryAgain")}
                  </Button>
                </div>
              ) : !isCreateDialogReady ? (
                <div
                  role="status"
                  aria-busy="true"
                  aria-live="polite"
                  data-testid="create-work-item-dialog-loading"
                >
                  <span className="sr-only">{t("common:empty.loading")}</span>
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-busy="true"
                      aria-live="polite"
                      data-testid="create-work-item-dialog-loading"
                    >
                      <span className="sr-only">
                        {t("common:empty.loading")}
                      </span>
                      <Skeleton className="h-10 w-full" />
                    </div>
                  }
                >
                  <CreateWorkItemDialogContent
                    onClose={closeCreateDialog}
                    projectId={project.id}
                    workspaceId={workspace?.id}
                  />
                </Suspense>
              )}
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
    </>
  );
}
