import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import { Filter, PanelsTopLeft, Rows3, Table2 } from "lucide-react";
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
import GroupControl from "@/components/common/group-control";
import SortControl from "@/components/common/sort-control";
import PageTitle from "@/components/page-title";
import {
  loadWorkItemCreateDialogShell,
  preloadWorkItemCreateDialogShell,
} from "@/components/work-item/work-item-create-dialog-shell-loader";
import WorkItemListLoading from "@/components/work-item/work-item-list-loading";
import type { WorkItemsResult } from "@/fetchers/work-item/get-work-items";
import useGetProjects from "@/hooks/queries/project/use-get-projects";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useBulkSelectionKeyboardShortcuts } from "@/hooks/use-bulk-selection-keyboard-shortcuts";
import type { WorkItemRealtimeStatus } from "@/hooks/use-native-work-item-realtime";
import {
  parseProjectLayout,
  parseTableColumns,
  useProjectViewPreference,
} from "@/hooks/use-project-view-preference";
import { afterFirstPaint } from "@/lib/i18n/after-first-paint";
import { normalizeCanonicalWorkItemSelection } from "@/lib/project-layout-navigation";

type CreateDialogShellComponent = Awaited<
  ReturnType<typeof loadWorkItemCreateDialogShell>
>["default"];

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
// Board layout, the selection switch and the bulk bar are loaded only when the URL or a
// capability asks for them, so the default list route's graph carries none of them (G11).
const WorkItemBoardView = lazy(
  () => import("@/components/work-item/work-item-board-view"),
);
const BulkAssignToolbar = lazy(
  () => import("@/components/work-item/bulk-assign-toolbar"),
);
// The structured filter editor is only fetched once the user opens it, or when the URL already
// carries a filter, so the default list route's graph does not include it (G11).
const WorkItemListControls = lazy(
  () => import("@/components/work-item/work-item-list-controls"),
);
const WorkItemSelectionToggle = lazy(
  () => import("@/components/work-item/work-item-selection-toggle"),
);
const WorkItemSidePane = lazy(
  () => import("@/components/work-item/work-item-side-pane"),
);

import type { WorkItemGroup } from "@/lib/project-board-search";
import {
  readProjectLayoutPreference,
  writeProjectLayoutPreference,
} from "@/lib/project-layout-preference";
import {
  parseWorkItemWorkSearch,
  type WorkItemFilterMode,
  type WorkItemListSearch,
  type WorkItemSearchColumn,
  type WorkItemSortDirection,
  type WorkItemSortField,
} from "@/lib/routes";

/**
 * `docs/02-design/screen-inventory.md` "Work — list", "Work — board", and "Work — table" (P1),
 * the v2 work-item screens on the v2 API (`VW-1`, `VW-2`, `VW-19`).
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
  validateSearch: (raw) =>
    parseWorkItemWorkSearch(normalizeCanonicalWorkItemSelection(raw)),
  beforeLoad: preloadWorkItemsPanel,
  component: WorkItemsRouteComponent,
});

function WorkItemsRouteComponent() {
  const { projectKey } = Route.useParams();
  return <ProjectWorkItemsRoute key={projectKey} projectKey={projectKey} />;
}

function ProjectWorkItemsRoute({ projectKey }: { projectKey: string }) {
  const { t } = useTranslation();
  const {
    layout,
    sort,
    dir,
    filter,
    filterMode,
    columns: urlColumns,
    item,
    group: urlGroup,
  } = Route.useSearch();
  const group: WorkItemGroup = urlGroup ?? "state";
  const isFiltered = !!filter?.trim();
  const boardSort = isFiltered && sort === "position" ? "key" : sort;
  const boardDir = isFiltered && sort === "position" ? "asc" : dir;
  const [isFilterOpen, setIsFilterOpen] = useState(isFiltered);
  // Focus moves into the editor only when the user opens it, never when the URL did.
  const [focusFilterEditor, setFocusFilterEditor] = useState(false);
  const filterToggleRef = useRef<HTMLButtonElement>(null);
  const toggleFilter = useCallback(() => {
    if (isFilterOpen) {
      setIsFilterOpen(false);
      setFocusFilterEditor(false);
      filterToggleRef.current?.focus();
    } else {
      setFocusFilterEditor(true);
      setIsFilterOpen(true);
    }
  }, [isFilterOpen]);
  const navigate = Route.useNavigate();
  const hasOpenedSidePane = useRef(false);
  if (item) hasOpenedSidePane.current = true;
  const openSidePane = useCallback(
    (key: string) => {
      void navigate({
        search: (prev: WorkItemListSearch) => ({ ...prev, item: key }),
        replace: true,
        resetScroll: false,
      });
    },
    [navigate],
  );
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // The dialog composition is warmed by the create trigger once it is visible (G11), so create
  // intent opens it as soon as it is clicked; its query-heavy form is a further dynamic module.
  const [CreateDialogShell, setCreateDialogShell] =
    useState<CreateDialogShellComponent>();
  const [createDialogLoad, setCreateDialogLoad] = useState<
    "idle" | "loading" | "failed"
  >("idle");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const loadedSelectionKeys = useRef(new Set<string>());
  // Per-row selection controls cost 500 Base UI checkboxes on a full list (G11), so they exist
  // only while the user is in selection mode.
  const [selectionMode, setSelectionMode] = useState(false);
  const [createIntentProjectContext, setCreateIntentProjectContext] =
    useState<string>();
  const createTriggerRef = useRef<HTMLButtonElement>(null);
  // Not needed to paint (G11), but create intent should open the dialog without a network wait,
  // so fetch it as soon as the route has painted.
  useEffect(() => {
    let cancelled = false;
    void afterFirstPaint().then(() => {
      if (!cancelled) preloadWorkItemCreateDialogShell();
    });
    return () => {
      cancelled = true;
    };
  }, []);
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
  const [boardFilterError, setBoardFilterError] = useState<unknown>();
  // The per-operation capability union is reported by the lazy selection toggle. It only
  // decides which controls render; the server enforces each bulk write.
  const [canBulkAct, setCanBulkAct] = useState(false);
  const canBulkAssign = canBulkAct && selectionMode;

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
  // `VW-19`: the chosen columns persist per person and project; a `columns` URL always wins.
  const columnsPreference = useProjectViewPreference({
    projectId: project?.id,
    name: "columns",
    parse: parseTableColumns,
  });
  const columns = urlColumns ?? columnsPreference.value;
  const setColumnsPreference = columnsPreference.set;
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
    setSelectedKeys([]);
    setSelectionMode(false);
    loadedSelectionKeys.current = new Set();
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
    setCreateDialogLoad("loading");
    loadWorkItemCreateDialogShell().then(
      (module) => {
        setCreateDialogShell(() => module.default);
        setCreateDialogLoad("idle");
      },
      () => {
        setCreateDialogLoad("failed");
        setIsCreateOpen(false);
        setCreateIntentProjectContext(undefined);
      },
    );
  }, [project?.id, projectContext]);

  const isTabularLayout = layout === "list" || layout === "table";

  const {
    data: workItemsResult,
    isLoading: isWorkItemsLoading,
    isError: isWorkItemsError,
    error: workItemsError,
    refetch: refetchWorkItems,
    hasNextPage: hasMoreWorkItems,
    isFetchingNextPage: isLoadingMoreWorkItems,
    isLoadMoreError,
    isPlaceholderData,
    fetchNextPage: fetchMoreWorkItems,
  } = useGetWorkItems({
    projectId: project?.id,
    projectSlug: project?.slug,
    workspaceId: workspace?.id,
    filter,
    columns,
    sort,
    dir,
    enabled: isTabularLayout,
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
    isWorkspaceError || isProjectsError || projectNotFound || isWorkItemsError;

  useEffect(() => {
    if (!project?.id) return;
    setRealtimeProjectId(project.id);
    setRealtimeStatus({ projectId: project.id, status: "connecting" });
  }, [project?.id]);

  // Restore the user's last-used layout for this project (`VW-2`) when navigating to the
  // work route without an explicit `?layout=` search parameter. The server preference
  // (`layout.<projectId>`) wins so it follows the person across browsers and devices; this
  // browser's own memory is the fallback while signed out, offline or never synced.
  const layoutPreference = useProjectViewPreference({
    projectId: project?.id,
    name: "layout",
    parse: parseProjectLayout,
  });
  const restoredLayoutProjectIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      !project?.id ||
      !layoutPreference.settled ||
      restoredLayoutProjectIdRef.current === project.id
    )
      return;
    restoredLayoutProjectIdRef.current = project.id;
    if (
      typeof window !== "undefined" &&
      !new URLSearchParams(window.location.search).has("layout")
    ) {
      const remembered =
        layoutPreference.value ?? readProjectLayoutPreference(project.id);
      if (layoutPreference.value)
        writeProjectLayoutPreference(project.id, layoutPreference.value);
      if (remembered && remembered !== layout) {
        navigate({
          search: (prev: WorkItemListSearch) => ({
            ...prev,
            layout: remembered,
          }),
          replace: true,
        });
      }
    }
  }, [
    project?.id,
    layout,
    navigate,
    layoutPreference.settled,
    layoutPreference.value,
  ]);

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

  // Applying a filter or switching the editor mode is a navigation, not a replacement, so the
  // back button steps through the queries the user tried (`VW-1`, AGENTS.md rule 4).
  const handleFilterApply = useCallback(
    (nextFilter: string) => {
      navigate({
        search: (prev: WorkItemListSearch) => ({
          ...prev,
          filter: nextFilter.trim() ? nextFilter : undefined,
        }),
      });
    },
    [navigate],
  );

  const handleFilterModeChange = useCallback(
    (nextMode: WorkItemFilterMode) => {
      navigate({
        search: (prev: WorkItemListSearch) => ({
          ...prev,
          filterMode: nextMode,
        }),
      });
    },
    [navigate],
  );

  const handleColumnsChange = useCallback(
    (nextColumns: WorkItemSearchColumn[] | undefined) => {
      setColumnsPreference(nextColumns?.length ? nextColumns : null);
      navigate({
        search: (prev: WorkItemListSearch) => ({
          ...prev,
          columns: nextColumns?.length ? nextColumns : undefined,
        }),
        replace: true,
      });
    },
    [navigate, setColumnsPreference],
  );

  const handleLayoutChange = useCallback(
    (nextLayout: WorkItemListSearch["layout"]) => {
      if (project?.id) {
        writeProjectLayoutPreference(project.id, nextLayout);
        layoutPreference.set(nextLayout);
      }
      navigate({
        search: (prev: WorkItemListSearch) => ({
          ...prev,
          layout: nextLayout,
        }),
        replace: true,
      });
    },
    [navigate, project?.id, layoutPreference.set],
  );

  // `VW-13`: the grouping lives in the URL (`VW-1`) and survives a layout switch; the default
  // (state) is never written.
  const handleGroupChange = useCallback(
    (nextGroup: WorkItemGroup) => {
      navigate({
        search: (prev: WorkItemListSearch) => ({
          ...prev,
          group: nextGroup === "state" ? undefined : nextGroup,
        }),
        replace: true,
      });
    },
    [navigate],
  );

  const handleCloseSidePane = useCallback(() => {
    navigate({
      search: (prev: WorkItemListSearch) => ({
        ...prev,
        item: undefined,
      }),
      replace: true,
      resetScroll: false,
    });
  }, [navigate]);

  const handleRetry = useCallback(() => {
    refetchProjects();
    if (project) refetchWorkItems();
  }, [project, refetchProjects, refetchWorkItems]);

  const handleSelectionChange = useCallback((key: string, checked: boolean) => {
    setSelectedKeys((current) =>
      checked
        ? current.includes(key) || current.length >= 500
          ? current
          : [...current, key]
        : current.filter((selected) => selected !== key),
    );
  }, []);

  const visibleItems = isTabularLayout ? workItemsResult?.items : undefined;
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      const keys = (visibleItems ?? [])
        .filter((item) => !item.unavailableFields.includes("key"))
        .map((item) => item.key);
      setSelectedKeys((current) =>
        checked
          ? [...new Set([...current, ...keys])].slice(0, 500)
          : current.filter((key) => !keys.includes(key)),
      );
    },
    [visibleItems],
  );

  // A selected item that has left the loaded set (deleted, moved out of reach, reassigned
  // away) must not stay selected: the bulk bar would count and send a key the user can no
  // longer see. The board view reports its own loaded set through the same callback.
  const pruneSelection = useCallback((present: Set<string>) => {
    loadedSelectionKeys.current = present;
    setSelectedKeys((current) =>
      current.every((key) => present.has(key))
        ? current
        : current.filter((key) => present.has(key)),
    );
  }, []);
  useEffect(() => {
    if (visibleItems) {
      pruneSelection(
        new Set(
          visibleItems
            .filter((item) => !item.unavailableFields.includes("key"))
            .map((item) => item.key),
        ),
      );
    }
  }, [visibleItems, pruneSelection]);

  const selectLoadedKeys = useCallback(() => {
    setSelectionMode(true);
    setSelectedKeys([...loadedSelectionKeys.current].slice(0, 500));
  }, []);
  const clearBulkSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys([]);
  }, []);
  useBulkSelectionKeyboardShortcuts(
    canBulkAct && !item && !isCreateOpenForProject,
    {
      selectAll: selectLoadedKeys,
      clearSelection: clearBulkSelection,
    },
  );
  const hasEnteredSelectionMode = useRef(false);
  const toggleSelectionMode = useCallback(() => {
    hasEnteredSelectionMode.current = true;
    setSelectionMode((on) => !on);
    setSelectedKeys([]);
  }, []);
  // One polite region for selection state (accessibility.md): entering or leaving the mode and
  // every change of the selected count.
  const selectionAnnouncement = selectionMode
    ? selectedKeys.length > 0
      ? t("workItems:bulk.selected", { count: selectedKeys.length })
      : t("workItems:bulk.modeOn")
    : hasEnteredSelectionMode.current
      ? t("workItems:bulk.modeOff")
      : "";

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
      <div className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-y-auto">
        <p className="sr-only" role="status" aria-live="polite">
          {selectionAnnouncement}
        </p>
        <h1 className="sr-only">
          {project ? project.name : projectKey} · {t("workItems:list.heading")}
        </h1>
        <div className="border-border/80 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70">
          <div className="flex min-h-10 items-center px-2 py-1.5 md:px-3">
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  ref={filterToggleRef}
                  variant="ghost"
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-foreground text-xs font-medium outline-none ring-0 hover:bg-accent/60"
                  aria-expanded={isFilterOpen}
                  aria-controls={
                    isFilterOpen ? "work-item-filter-controls" : undefined
                  }
                  onClick={toggleFilter}
                >
                  <Filter className="h-3 w-3" />
                  {isFiltered
                    ? t("workItems:filter.toggleActive")
                    : t("common:actions.filter")}
                </Button>
                <SortControl
                  fields={
                    layout === "board" && isFiltered
                      ? ["title", "priority", "dueDate", "number"]
                      : ["position", "title", "priority", "dueDate", "number"]
                  }
                  sort={{
                    field:
                      (layout === "board" ? boardSort : sort) === "key"
                        ? "number"
                        : layout === "board"
                          ? boardSort
                          : sort,
                    direction: layout === "board" ? boardDir : dir,
                  }}
                  onSortChange={(next) => {
                    if (next.field === "createdAt") return;
                    handleSortChange(
                      next.field === "number" ? "key" : next.field,
                      next.direction,
                    );
                  }}
                />
                {layout === "board" ? (
                  <GroupControl
                    group={group}
                    onGroupChange={handleGroupChange}
                    groups={["state", "assignee", "priority"]}
                  />
                ) : null}
              </div>
              <div className="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2 sm:w-auto">
                {project ? (
                  <Suspense fallback={null}>
                    <WorkItemSelectionToggle
                      workspaceId={project.workspaceId}
                      projectId={project.id}
                      selectionMode={selectionMode}
                      onToggle={toggleSelectionMode}
                      onCapabilityChange={setCanBulkAct}
                    />
                  </Suspense>
                ) : null}
                <fieldset
                  aria-label={t("workItems:list.layoutGroup")}
                  className="m-0 inline-flex min-w-0 items-center gap-1 border-0 p-0"
                >
                  {(
                    [
                      ["board", PanelsTopLeft, "tasks:view.board"],
                      ["list", Rows3, "tasks:view.list"],
                      ["table", Table2, "workItems:list.tableLayout"],
                    ] as const
                  ).map(([mode, Icon, label]) => (
                    <Button
                      key={mode}
                      variant="ghost"
                      type="button"
                      className={`inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors ${layout === mode ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"}`}
                      aria-pressed={layout === mode}
                      onClick={() => handleLayoutChange(mode)}
                    >
                      <Icon className="h-3 w-3" />
                      {t(label)}
                    </Button>
                  ))}
                </fieldset>
                {project ? (
                  <Suspense fallback={null}>
                    <WorkItemCreateTrigger
                      workspaceId={project.workspaceId}
                      projectId={project.id}
                      buttonRef={createTriggerRef}
                      pending={createDialogLoad === "loading"}
                      onClick={openCreateDialog}
                    />
                  </Suspense>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        {isFilterOpen ? (
          <div id="work-item-filter-controls">
            <Suspense fallback={null}>
              <WorkItemListControls
                autoFocus={focusFilterEditor}
                onClose={toggleFilter}
                filter={filter ?? ""}
                mode={filterMode ?? "visual"}
                workItemsError={
                  layout === "board" ? boardFilterError : workItemsError
                }
                onModeChange={handleFilterModeChange}
                onApply={handleFilterApply}
                columns={columns}
                onColumnsChange={
                  layout === "table" ? handleColumnsChange : undefined
                }
                workspaceId={workspace?.id}
                projectSlug={project?.slug}
                sort={sort}
                dir={dir}
              />
            </Suspense>
          </div>
        ) : null}
        {createDialogLoad === "failed" ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 text-sm"
          >
            <span>{t("workItems:create.loadFailed")}</span>
            {/* A failed dynamic import is remembered by the browser for this document, so a
                second attempt cannot succeed; a reload is the retry that works. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              {t("workItems:create.reload")}
            </Button>
          </div>
        ) : null}
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
              onClear={clearBulkSelection}
            />
          </Suspense>
        ) : null}
        {isTabularLayout ? (
          <Suspense fallback={<WorkItemListLoading />}>
            <WorkItemsPanel
              layout={layout === "list" ? "list" : "table"}
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
              columns={columns}
              isFiltered={isFiltered}
              hasMore={hasMoreWorkItems}
              onLoadMore={() => void fetchMoreWorkItems()}
              isLoadingMore={isLoadingMoreWorkItems}
              isLoadMoreError={isLoadMoreError}
              isPlaceholderData={isPlaceholderData}
              selectedKeys={selectedKeys}
              canBulkAssign={canBulkAssign}
              onSelectionChange={handleSelectionChange}
              onSelectAll={handleSelectAll}
              onOpenItem={openSidePane}
            />
          </Suspense>
        ) : project ? (
          <Suspense fallback={<WorkItemListLoading />}>
            <WorkItemBoardView
              group={group}
              sort={boardSort}
              dir={boardDir}
              project={project}
              workspaceId={workspace?.id}
              filter={filter}
              realtimeProjectId={realtimeProjectId}
              realtimeStatus={realtimeStatus}
              onRealtimeAvailabilityChange={handleRealtimeAvailabilityChange}
              canSelect={canBulkAssign}
              selectedKeys={selectedKeys}
              onSelectionChange={handleSelectionChange}
              onPruneSelection={pruneSelection}
              onOpenItem={openSidePane}
              onErrorChange={setBoardFilterError}
            />
          </Suspense>
        ) : (
          <Suspense fallback={<WorkItemListLoading />}>
            <WorkItemsPanel
              layout={layout === "list" ? "list" : "table"}
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
        {hasOpenedSidePane.current ? (
          <Suspense fallback={null}>
            <WorkItemSidePane itemKey={item} onClose={handleCloseSidePane} />
          </Suspense>
        ) : null}
        {project && isCreateOpenForProject && CreateDialogShell ? (
          <CreateDialogShell
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
