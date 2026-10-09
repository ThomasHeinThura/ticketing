import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import BoardToolbar from "@/components/board/board-toolbar";
import ProjectLayout from "@/components/common/project-layout";
import ProjectTaskSearchInput from "@/components/common/project-task-search-input";
import KanbanBoard from "@/components/kanban-board";
import ListView from "@/components/list-view";
import PageTitle from "@/components/page-title";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import { shortcuts } from "@/constants/shortcuts";
import { hasPendingTaskUpdate } from "@/hooks/mutations/task/use-update-task";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTaskFiltersWithLabelsSupport } from "@/hooks/use-task-filters-with-labels-support";
import { authClient } from "@/lib/auth-client";
import {
  type ProjectBoardSearch,
  parseProjectBoardSearch,
} from "@/lib/project-board-search";
import {
  projectViewFiltersFromSearch,
  projectViewSortFromSearch,
  resolveProjectBoardLayout,
  withProjectBoardLayout,
  withProjectBoardTask,
  withProjectViewFilters,
  withProjectViewSort,
  withProjectViewState,
} from "@/lib/project-board-search-state";
import { createProjectViewShortcutHandlers } from "@/lib/project-layout-navigation";
import {
  getProjectLayoutStorage,
  readProjectLayoutPreference,
  writeProjectLayoutPreference,
} from "@/lib/project-layout-preference";
import { PROJECT_BOARD_PATH } from "@/lib/routes";
import { sortTasks } from "@/lib/sort-tasks";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/board",
)({
  component: RouteComponent,
  validateSearch: parseProjectBoardSearch,
});

const skeletonColumns = [
  { key: "col-todo", cards: 3 },
  { key: "col-progress", cards: 4 },
  { key: "col-review", cards: 2 },
  { key: "col-done", cards: 1 },
];

function BoardSkeleton() {
  return (
    <div
      className="flex h-full w-full gap-4 p-4 overflow-hidden"
      data-testid="g13-board-loading"
    >
      {skeletonColumns.map((col) => (
        <div key={col.key} className="flex w-72 shrink-0 flex-col gap-3">
          <div className="flex items-center gap-2 px-1">
            <div className="h-3 w-3 rounded-full bg-muted animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted animate-pulse" />
            <div className="h-4 w-5 rounded bg-muted animate-pulse" />
          </div>
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: col.cards }, (_, i) => `${col.key}-${i}`).map(
              (cardKey) => (
                <div
                  key={cardKey}
                  className="rounded-lg border border-border bg-card p-3 space-y-2.5"
                >
                  <div className="h-3.5 w-4/5 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-3/5 rounded bg-muted animate-pulse" />
                  <div className="flex items-center gap-2 pt-1">
                    <div className="h-5 w-5 rounded-full bg-muted animate-pulse" />
                    <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const { taskId, layout } = search;
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const { data } = useGetTasks(projectId);
  const queryClient = useQueryClient();
  const { project, setProject } = useProjectStore();
  const profileDefaultViewMode = useUserPreferencesStore(
    (state) => state.viewMode,
  );
  const savedProjectViewMode = readProjectLayoutPreference(
    getProjectLayoutStorage(),
    session?.user.id,
    projectId,
  );
  const viewMode = resolveProjectBoardLayout(
    layout,
    savedProjectViewMode ?? profileDefaultViewMode,
  );
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const boardSearchInput = useRef<HTMLInputElement>(null);
  const urlFilters = projectViewFiltersFromSearch(search);
  const sort = projectViewSortFromSearch(search);

  const updateViewState = useCallback(
    (patch: Partial<ProjectBoardSearch>) => {
      navigate({
        to: PROJECT_BOARD_PATH,
        params: { workspaceId, projectId },
        search: (previous: ProjectBoardSearch) =>
          withProjectViewState(previous, patch),
        replace: true,
      });
    },
    [navigate, projectId, workspaceId],
  );

  const handleFiltersChange = useCallback(
    (nextFilters: ReturnType<typeof projectViewFiltersFromSearch>) => {
      navigate({
        to: PROJECT_BOARD_PATH,
        params: { workspaceId, projectId },
        search: (previous: ProjectBoardSearch) =>
          withProjectViewFilters(previous, nextFilters),
      });
    },
    [navigate, projectId, workspaceId],
  );

  const setSort = useCallback(
    (nextSort: ReturnType<typeof projectViewSortFromSearch>) => {
      navigate({
        to: PROJECT_BOARD_PATH,
        params: { workspaceId, projectId },
        search: (previous: ProjectBoardSearch) =>
          withProjectViewSort(previous, nextSort),
      });
    },
    [navigate, projectId, workspaceId],
  );

  const handleViewModeChange = useCallback(
    (nextLayout: "board" | "list") => {
      writeProjectLayoutPreference(
        typeof window === "undefined" ? undefined : window.localStorage,
        session?.user.id,
        projectId,
        nextLayout,
      );
      navigate({
        to: PROJECT_BOARD_PATH,
        params: { workspaceId, projectId },
        search: (previous: ProjectBoardSearch) =>
          withProjectBoardLayout(previous, nextLayout),
      });
    },
    [navigate, projectId, session?.user.id, workspaceId],
  );

  const { data: users } = useGetActiveWorkspaceUsers(workspaceId);
  const { data: workspaceLabels = [] } = useGetLabelsByWorkspace(workspaceId);

  const handleCloseTaskSheet = useCallback(() => {
    navigate({
      to: PROJECT_BOARD_PATH,
      params: { workspaceId, projectId },
      search: (previous: ProjectBoardSearch) =>
        withProjectBoardTask(previous, undefined),
      replace: true,
    });
  }, [navigate, projectId, workspaceId]);

  const viewShortcutHandlers = createProjectViewShortcutHandlers(
    { workspaceId, projectId },
    location.searchStr,
    (href) => navigate({ href }),
    (layout) =>
      writeProjectLayoutPreference(
        getProjectLayoutStorage(),
        session?.user.id,
        projectId,
        layout,
      ),
  );

  useRegisterShortcuts({
    sequentialShortcuts: {
      [shortcuts.view.prefix]: {
        [shortcuts.view.board]: viewShortcutHandlers.board,
        [shortcuts.view.list]: viewShortcutHandlers.list,
        [shortcuts.view.calendar]: viewShortcutHandlers.calendar,
        [shortcuts.view.gantt]: viewShortcutHandlers.gantt,
        [shortcuts.view.backlog]: viewShortcutHandlers.backlog,
      },
    },
  });

  useEffect(() => {
    if (data && !hasPendingTaskUpdate(queryClient, projectId)) {
      setProject(data);
    }
  }, [data, projectId, queryClient, setProject]);

  // The query result is renderable before the effect synchronizes the shared
  // project store. Use it for first paint when the store has no project (or a
  // different route's project), while retaining same-project optimistic edits.
  const queriedProject = data?.id === projectId ? data : undefined;
  const boardSourceProject =
    project?.id === projectId ? project : queriedProject;
  const {
    filters,
    updateFilter,
    updateLabelFilter,
    filteredProject,
    hasActiveFilters,
    clearFilters,
  } = useTaskFiltersWithLabelsSupport(
    boardSourceProject,
    urlFilters,
    search.q,
    handleFiltersChange,
  );

  const sortedProject = useMemo(() => {
    if (!filteredProject || sort.field === "position") return filteredProject;
    return {
      ...filteredProject,
      columns: filteredProject.columns.map((column) => ({
        ...column,
        tasks: sortTasks(column.tasks, sort),
      })),
    };
  }, [filteredProject, sort]);

  const boardHeaderSearch = (
    <ProjectTaskSearchInput
      inputRef={boardSearchInput}
      value={search.q ?? ""}
      onValueChange={(q) => updateViewState({ q: q || undefined })}
      placeholder={t("tasks:boardSearchPlaceholder")}
      clearLabel={t("common:actions.clearAll")}
    />
  );

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="board"
      headerActions={boardHeaderSearch}
    >
      <PageTitle
        title={`${project?.name} · ${viewMode === "board" ? t("tasks:view.board") : t("tasks:view.list")}`}
        hideAppName
      />
      <div className="relative flex flex-col h-full min-h-0 overflow-hidden">
        <BoardToolbar
          project={project}
          filters={filters}
          updateFilter={updateFilter}
          updateLabelFilter={updateLabelFilter}
          clearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
          users={users}
          workspaceLabels={workspaceLabels}
          viewMode={viewMode}
          setViewMode={handleViewModeChange}
          sort={sort}
          onSortChange={setSort}
        />

        <div
          className="flex h-full flex-1 overflow-hidden bg-background"
          data-testid={sortedProject ? "g13-board-content" : undefined}
          data-primary-content-ready={sortedProject ? "true" : undefined}
        >
          {sortedProject ? (
            viewMode === "board" ? (
              <KanbanBoard
                project={sortedProject}
                workspaceId={workspaceId}
                workspaceUsers={users}
                disableDragDrop={sort.field !== "position"}
              />
            ) : (
              <ListView
                project={sortedProject}
                disableDragDrop={sort.field !== "position"}
              />
            )
          ) : (
            <BoardSkeleton />
          )}
        </div>

        <CreateTaskModal
          open={isTaskModalOpen}
          projectId={projectId}
          onClose={() => setIsTaskModalOpen(false)}
        />

        <TaskDetailsSheet
          taskId={taskId}
          projectId={projectId}
          workspaceId={workspaceId}
          onClose={handleCloseTaskSheet}
        />
      </div>
    </ProjectLayout>
  );
}
