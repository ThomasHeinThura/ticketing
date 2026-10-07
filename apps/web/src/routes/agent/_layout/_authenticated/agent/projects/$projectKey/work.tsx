import { createFileRoute } from "@tanstack/react-router";
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
import WorkItemCreateDialogShell from "@/components/work-item/work-item-create-dialog-shell";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";

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
  beforeLoad: preloadWorkItemsPanel,
  component: WorkItemsRouteComponent,
});

function WorkItemsRouteComponent() {
  const { projectKey } = Route.useParams();
  return <ProjectWorkItemsRoute key={projectKey} projectKey={projectKey} />;
}

function ProjectWorkItemsRoute({ projectKey }: { projectKey: string }) {
  const { t } = useTranslation();
  const { sort, dir } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createIntentProjectContext, setCreateIntentProjectContext] =
    useState<string>();
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  const focusRestoreGenerationRef = useRef(0);
  const pendingFocusRestoreRef = useRef<
    | {
        generation: number;
        projectContext: string | undefined;
      }
    | undefined
  >(undefined);
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
    project?.workspaceId && project.id
      ? `${project.workspaceId}:${project.id}`
      : undefined;
  const projectContextRef = useRef(projectContext);
  const isCreateOpenForProject =
    isCreateOpen && createIntentProjectContext === projectContext;

  useLayoutEffect(() => {
    if (projectContextRef.current === projectContext) return;
    projectContextRef.current = projectContext;
    focusRestoreGenerationRef.current += 1;
    pendingFocusRestoreRef.current = undefined;
    setIsCreateOpen(false);
    setCreateIntentProjectContext(undefined);
  }, [projectContext]);

  useLayoutEffect(
    () => () => {
      focusRestoreGenerationRef.current += 1;
    },
    [],
  );

  const closeCreateDialog = useCallback(() => {
    const closedProjectContext = projectContextRef.current;
    const generation = ++focusRestoreGenerationRef.current;
    pendingFocusRestoreRef.current = {
      generation,
      projectContext: closedProjectContext,
    };
    setIsCreateOpen(false);
    setCreateIntentProjectContext(undefined);
  }, []);
  const getCreateDialogFinalFocus = useCallback(() => {
    const pending = pendingFocusRestoreRef.current;
    const trigger = createTriggerRef.current;
    if (
      !pending ||
      pending.generation !== focusRestoreGenerationRef.current ||
      pending.projectContext !== projectContextRef.current ||
      !trigger?.isConnected
    ) {
      return false;
    }
    pendingFocusRestoreRef.current = undefined;
    return trigger;
  }, []);
  const openCreateDialog = useCallback(() => {
    if (!project?.id || !projectContext) return;
    focusRestoreGenerationRef.current += 1;
    pendingFocusRestoreRef.current = undefined;
    setIsCreateOpen(true);
    setCreateIntentProjectContext(projectContext);
  }, [project?.id, projectContext]);

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
                buttonRef={createTriggerRef}
                onClick={openCreateDialog}
              />
            </Suspense>
          ) : null}
        </div>
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
        {project && isCreateOpenForProject ? (
          <WorkItemCreateDialogShell
            projectId={project.id}
            workspaceId={project.workspaceId}
            onClose={closeCreateDialog}
            finalFocus={getCreateDialogFinalFocus}
          />
        ) : null}
      </div>
    </>
  );
}
