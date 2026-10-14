import { createFileRoute } from "@tanstack/react-router";
import { Alert, AlertDescription, Button } from "@taskdesk/ui";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import PageTitle from "@/components/page-title";
// Keep the small dialog composition available so create intent opens synchronously;
// its query-heavy form is a separate dynamic module verified by the G11 route graph.
import WorkItemCreateDialogShell from "@/components/work-item/work-item-create-dialog-shell";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import useGetProjectStates from "@/hooks/queries/project/use-get-project-states";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";

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
  // The panel renders the list, which is its own chunk. Requesting it only once the panel
  // mounts makes the list suspend behind the panel skeleton and lands the rows after React's
  // 300 ms fallback throttle (G11 work-list render), so start it with the panel.
  void import("@/components/work-item/work-item-list").catch(() => undefined);
}

const WorkItemsPanel = lazy(loadWorkItemsPanel);
const WorkItemCreateTrigger = lazy(
  () => import("@/components/work-item/work-item-create-trigger"),
);
// Board layout and the bulk bar are loaded only when the URL or a selection asks for them,
// so the default list route does not pay for either.
const WorkItemBoard = lazy(
  () => import("@/components/work-item/work-item-board"),
);
const BulkAssignToolbar = lazy(
  () => import("@/components/work-item/bulk-assign-toolbar"),
);
const WorkItemListRealtime = lazy(
  () => import("@/components/work-item/work-item-list-realtime"),
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
  const { layout, sort, dir } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  // Per-row selection controls cost 500 Base UI checkboxes on a full list (G11), so they exist
  // only while the user is in selection mode.
  const [selectionMode, setSelectionMode] = useState(false);
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
  // The strict capability flags from /api/capabilities (the create trigger already reads the
  // same cached query). They decide only which controls render; the server enforces each write.
  const {
    canAssignTasks,
    canTransitionTasks,
    canRankTasks,
    isCheckingPermissions,
  } = useWorkspacePermission();
  const canAssign = !isCheckingPermissions && canAssignTasks();
  const canBulkAssign = canAssign && selectionMode;

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
  const boardWorkItems = useMemo(
    () => boardItemsQuery.data?.pages.flatMap((page) => page.items),
    [boardItemsQuery.data],
  );
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

  const handleLayoutChange = useCallback(
    (nextLayout: WorkItemListSearch["layout"]) => {
      navigate({
        search: (prev: WorkItemListSearch) => ({
          ...prev,
          layout: nextLayout,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const refetchBoardItems = boardItemsQuery.refetch;
  const refetchProjectStates = projectStates.refetch;
  const handleRetry = useCallback(() => {
    refetchProjects();
    if (!project) return;
    if (layout === "board") {
      void refetchBoardItems();
      void refetchProjectStates();
    } else {
      void refetchWorkItems();
    }
  }, [
    layout,
    project,
    refetchBoardItems,
    refetchProjects,
    refetchProjectStates,
    refetchWorkItems,
  ]);

  const handleSelectionChange = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((current) =>
      checked
        ? current.includes(key)
          ? current
          : [...current, key]
        : current.filter((selected) => selected !== key),
    );
  }, []);

  const visibleItems =
    layout === "board" ? boardWorkItems : workItemsResult?.items;
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      const keys = (visibleItems ?? [])
        .filter((item) => !item.unavailableFields.includes("key"))
        .map((item) => item.key);
      setSelectedKeys((current) =>
        checked
          ? [...new Set([...current, ...keys])]
          : current.filter((key) => !keys.includes(key)),
      );
    },
    [visibleItems],
  );

  // A selected item that has left the loaded set (deleted, moved out of reach, reassigned
  // away) must not stay selected: the bulk bar would count and send a key the user can no
  // longer see.
  useEffect(() => {
    if (!visibleItems) return;
    const present = new Set(visibleItems.map((item) => item.key));
    setSelectedKeys((current) =>
      current.every((key) => present.has(key))
        ? current
        : current.filter((key) => present.has(key)),
    );
  }, [visibleItems]);

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
      <div
        className={`flex h-full flex-col gap-4 overflow-y-auto p-6${
          layout === "board" ? " w-full min-w-0" : ""
        }`}
      >
        <div
          className={`flex items-center justify-between gap-3${
            layout === "board" ? " flex-wrap" : ""
          }`}
        >
          <h1 className="font-semibold text-lg">
            {project ? project.name : projectKey} ·{" "}
            {t("workItems:list.heading")}
          </h1>
          <div className="flex items-center gap-2">
            <fieldset
              aria-label={t("workItems:list.layoutGroup")}
              className="m-0 flex min-w-0 items-center gap-1 border-0 p-0"
            >
              <Button
                variant={layout === "list" ? "secondary" : "outline"}
                size="sm"
                aria-pressed={layout === "list"}
                onClick={() => handleLayoutChange("list")}
              >
                {t("workItems:list.listLayout")}
              </Button>
              <Button
                variant={layout === "board" ? "secondary" : "outline"}
                size="sm"
                aria-pressed={layout === "board"}
                onClick={() => handleLayoutChange("board")}
              >
                {t("workItems:list.boardLayout")}
              </Button>
            </fieldset>
            {project && canAssign ? (
              <Button
                variant={selectionMode ? "secondary" : "outline"}
                size="sm"
                aria-pressed={selectionMode}
                onClick={() => {
                  setSelectionMode((on) => !on);
                  setSelectedKeys([]);
                }}
              >
                {t("workItems:bulk.selectMode")}
              </Button>
            ) : null}
            {project ? (
              <Suspense fallback={null}>
                <WorkItemCreateTrigger
                  buttonRef={createTriggerRef}
                  onClick={openCreateDialog}
                />
              </Suspense>
            ) : null}
          </div>
        </div>
        {project && selectedKeys.length > 0 && canBulkAssign ? (
          <Suspense fallback={null}>
            <BulkAssignToolbar
              projectId={project.id}
              workspaceId={project.workspaceId}
              selectedKeys={selectedKeys}
              onAssigned={(succeeded) =>
                setSelectedKeys((current) =>
                  current.filter((key) => !succeeded.includes(key)),
                )
              }
              onClear={() => setSelectedKeys([])}
            />
          </Suspense>
        ) : null}
        {layout === "list" ? (
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
              selectedKeys={selectedKeys}
              canBulkAssign={canBulkAssign}
              onSelectionChange={handleSelectionChange}
              onSelectAll={handleSelectAll}
            />
          </Suspense>
        ) : project ? (
          <>
            {realtimeStatus?.projectId === project.id &&
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
              <WorkItemBoard
                projectId={project.id}
                states={projectStates.data}
                statesError={projectStates.isError}
                workItems={boardWorkItems}
                isLoading={isLoading}
                isError={isError}
                onRetry={handleRetry}
                hasMore={boardItemsQuery.hasNextPage}
                isLoadingMore={boardItemsQuery.isFetchingNextPage}
                onLoadMore={() => {
                  void boardItemsQuery.fetchNextPage();
                }}
                canSelect={canBulkAssign}
                canTransition={!isCheckingPermissions && canTransitionTasks()}
                canRank={!isCheckingPermissions && canRankTasks()}
                selectedKeys={selectedKeys}
                onSelectionChange={handleSelectionChange}
              />
            </Suspense>
            {!isLoading && realtimeProjectId === project.id ? (
              <Suspense fallback={null}>
                <WorkItemListRealtime
                  key={project.id}
                  projectId={project.id}
                  onAvailabilityChange={handleRealtimeAvailabilityChange}
                />
              </Suspense>
            ) : null}
          </>
        ) : (
          <Suspense fallback={<WorkItemListLoading />}>
            <WorkItemsPanel
              project={project}
              workItemsResult={undefined}
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
        )}
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
