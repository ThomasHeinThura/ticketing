import { createFileRoute } from "@tanstack/react-router";
import { Button, Skeleton } from "@taskdesk/ui";
import { saveAs } from "file-saver";
import { Download, Loader2 } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
import WorkItemFilterEditor from "@/components/work-item/work-item-filter-editor";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import { exportWorkItems } from "@/fetchers/work-item/export-work-items";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { HttpError } from "@/lib/http-error";
import { toast } from "@/lib/toast";

type WorkItemsPanelModule =
  typeof import("@/components/work-item/work-items-panel");

let workItemsPanelModulePromise: Promise<WorkItemsPanelModule> | undefined;

function loadWorkItemsPanel(): Promise<WorkItemsPanelModule> {
  if (!workItemsPanelModulePromise) {
    workItemsPanelModulePromise = import(
      "@/components/work-item/work-items-panel"
    ).catch((error: unknown) => {
      workItemsPanelModulePromise = undefined;
      throw error;
    });
  }
  return workItemsPanelModulePromise;
}

function preloadWorkItemsPanel() {
  void loadWorkItemsPanel().catch(() => undefined);
}

const WorkItemsPanel = lazy(loadWorkItemsPanel);
const WorkItemCreateTrigger = lazy(
  () => import("@/components/work-item/work-item-create-trigger"),
);
type CreateWorkItemDialogModule =
  typeof import("@/components/work-item/work-item-create-dialog-shell");

let createWorkItemDialogModulePromise:
  | Promise<CreateWorkItemDialogModule>
  | undefined;

function loadCreateWorkItemDialog(): Promise<CreateWorkItemDialogModule> {
  if (!createWorkItemDialogModulePromise) {
    createWorkItemDialogModulePromise = import(
      "@/components/work-item/work-item-create-dialog-shell"
    ).catch((error: unknown) => {
      createWorkItemDialogModulePromise = undefined;
      throw error;
    });
  }
  return createWorkItemDialogModulePromise;
}

const WorkItemCreateDialogShell = lazy(loadCreateWorkItemDialog);

import {
  parseWorkItemListSearch,
  resolveWorkItemListSort,
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
  beforeLoad: preloadWorkItemsPanel,
  component: WorkItemsRouteComponent,
});

function WorkItemsRouteComponent() {
  const { projectKey } = Route.useParams();
  return <ProjectWorkItemsRoute key={projectKey} projectKey={projectKey} />;
}

function ProjectWorkItemsRoute({ projectKey }: { projectKey: string }) {
  const { t } = useTranslation();
  const { sort, dir, filter, filterMode, columns } = Route.useSearch();
  const effectiveSort = resolveWorkItemListSort({ sort, dir });
  const activeSort = effectiveSort.field;
  const activeDir = effectiveSort.order;
  const querySort = effectiveSort.querySort;
  const navigate = Route.useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCreateDialogReady, setIsCreateDialogReady] = useState(false);
  const [isCreateDialogLoadError, setIsCreateDialogLoadError] = useState(false);
  const [createIntentProjectContext, setCreateIntentProjectContext] =
    useState<string>();
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const createIntentGenerationRef = useRef(0);
  const [realtimeProjectId, setRealtimeProjectId] = useState<string>();
  const [realtimeStatus, setRealtimeStatus] = useState<{
    projectId: string;
    status: WorkItemRealtimeStatus;
  }>();
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
  const projectContext =
    workspace?.id && project?.id ? `${workspace.id}:${project.id}` : undefined;
  const projectContextRef = useRef(projectContext);
  const isCreateOpenForProject =
    isCreateOpen && createIntentProjectContext === projectContext;

  useLayoutEffect(() => {
    if (projectContextRef.current === projectContext) return;
    projectContextRef.current = projectContext;
    createIntentGenerationRef.current += 1;
    setIsCreateOpen(false);
    setIsCreateDialogReady(false);
    setIsCreateDialogLoadError(false);
    setCreateIntentProjectContext(undefined);
  }, [projectContext]);

  useLayoutEffect(
    () => () => {
      createIntentGenerationRef.current += 1;
    },
    [],
  );

  const closeCreateDialog = useCallback(() => {
    createIntentGenerationRef.current += 1;
    setIsCreateOpen(false);
    setIsCreateDialogReady(false);
    setIsCreateDialogLoadError(false);
    setCreateIntentProjectContext(undefined);
  }, []);
  const openCreateDialog = useCallback(() => {
    if (!projectContext) return;
    const intentGeneration = ++createIntentGenerationRef.current;
    setIsCreateOpen(true);
    setIsCreateDialogReady(false);
    setIsCreateDialogLoadError(false);
    setCreateIntentProjectContext(projectContext);

    void (async () => {
      try {
        await loadCreateWorkItemDialog();
        if (
          createIntentGenerationRef.current !== intentGeneration ||
          projectContextRef.current !== projectContext
        ) {
          return;
        }
        setIsCreateDialogReady(true);
      } catch {
        if (
          createIntentGenerationRef.current !== intentGeneration ||
          projectContextRef.current !== projectContext
        ) {
          return;
        }
        setIsCreateDialogLoadError(true);
      }
    })();
  }, [projectContext]);

  const {
    data: workItemsResult,
    isLoading: isWorkItemsLoading,
    isError: isWorkItemsError,
    error: workItemsError,
    refetch: refetchWorkItems,
  } = useGetWorkItems({
    projectId: project?.id,
    projectSlug: project?.slug,
    workspaceId: workspace?.id,
    filter,
    sort: activeSort,
    dir: activeDir,
    columns,
    querySort,
    realtimeStatus:
      realtimeStatus && realtimeStatus.projectId === project?.id
        ? realtimeStatus.status
        : "connecting",
  });

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

  useEffect(() => {
    if (
      !isCreateOpenForProject ||
      isCreateDialogReady ||
      isCreateDialogLoadError
    )
      return;

    const cancelPendingOpen = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsCreateOpen(false);
      createTriggerRef.current?.focus();
    };

    window.addEventListener("keydown", cancelPendingOpen);
    return () => window.removeEventListener("keydown", cancelPendingOpen);
  }, [isCreateDialogLoadError, isCreateDialogReady, isCreateOpenForProject]);

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

  const handleExport = useCallback(async () => {
    if (!workspace?.id || !project || isExporting) return;
    setIsExporting(true);
    try {
      const csv = await exportWorkItems({
        workspaceId: workspace.id,
        projectSlug: project.slug,
        filter: filter ?? "",
        sort: activeSort,
        dir: activeDir,
      });
      saveAs(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        `${project.slug}-work-items.csv`,
      );
    } catch {
      toast.error(t("common:error.title"));
    } finally {
      setIsExporting(false);
    }
  }, [activeDir, activeSort, filter, isExporting, project, t, workspace?.id]);

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
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleExport()}
                disabled={isExporting || !workspace?.id}
              >
                {isExporting ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {t("workItems:list.export")}
              </Button>
              <Suspense fallback={null}>
                <WorkItemCreateTrigger
                  buttonRef={createTriggerRef}
                  onPreload={preloadCreateWorkItemDialog}
                  onClick={openCreateDialog}
                />
              </Suspense>
            </div>
          ) : null}
        </div>
        {project && isCreateOpenForProject && isCreateDialogLoadError ? (
          <div role="alert">
            <p>{t("common:error.title")}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              {t("common:error.tryAgain")}
            </Button>
          </div>
        ) : null}
        <WorkItemFilterEditor
          filter={filter ?? ""}
          mode={filterMode ?? "visual"}
          apiError={
            workItemsError instanceof HttpError &&
            [400, 403, 422].includes(workItemsError.status)
              ? `${workItemsError.status}: ${workItemsError.message}`
              : undefined
          }
          onModeChange={(nextMode) =>
            navigate({
              search: (prev: WorkItemListSearch) => ({
                ...prev,
                filterMode: nextMode,
              }),
            })
          }
          onApply={(nextFilter) =>
            navigate({
              search: (prev: WorkItemListSearch) => ({
                ...prev,
                ...(nextFilter
                  ? { filter: nextFilter }
                  : { filter: undefined }),
              }),
            })
          }
        />
        <Suspense fallback={<WorkItemListLoading />}>
          <WorkItemsPanel
            project={project}
            workItemsResult={workItemsResult as WorkItemsResult | undefined}
            isLoading={isLoading}
            isError={isError}
            realtimeProjectId={realtimeProjectId}
            realtimeStatus={realtimeStatus}
            sort={activeSort}
            dir={activeDir}
            columns={columns}
            onSortChange={handleSortChange}
            onRealtimeAvailabilityChange={handleRealtimeAvailabilityChange}
            onRetry={handleRetry}
          />
        </Suspense>
        {project && isCreateOpenForProject && !isCreateDialogLoadError ? (
          <Suspense
            fallback={
              <div
                role="status"
                aria-busy="true"
                aria-live="polite"
                data-testid="create-work-item-dialog-loading"
              >
                <span className="sr-only">{t("common:empty.loading")}</span>
                <Skeleton className="h-10 w-full" />
              </div>
            }
          >
            {isCreateDialogReady ? (
              <WorkItemCreateDialogShell
                projectId={project.id}
                workspaceId={workspace?.id}
                onClose={closeCreateDialog}
              />
            ) : (
              <div
                role="status"
                aria-busy="true"
                aria-live="polite"
                data-testid="create-work-item-dialog-loading"
              >
                <span className="sr-only">{t("common:empty.loading")}</span>
                <Skeleton className="h-10 w-full" />
              </div>
            )}
          </Suspense>
        ) : null}
      </div>
    </>
  );
}
