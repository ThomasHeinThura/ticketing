import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { Skeleton, useIsMobile } from "@taskdesk/ui";
import { startOfMonth } from "date-fns";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import CalendarToolbar from "@/components/calendar/calendar-toolbar";
import MonthGrid from "@/components/calendar/month-grid";
import {
  buildMonthWeeks,
  tasksInWeeks,
} from "@/components/calendar/month-grid-model";
import ScheduleFilterChips, {
  buildScheduleFilterChips,
} from "@/components/calendar/schedule-filter-chips";
import ScheduleViewState, {
  scheduleViewStatus,
} from "@/components/calendar/schedule-view-state";
import ProjectLayout from "@/components/common/project-layout";
import ProjectTaskSearchHeader from "@/components/common/project-task-search-header";
import ProjectViewFeatureGate from "@/components/common/project-view-feature-gate";
import WorkspaceLayout from "@/components/common/workspace-layout";
import PageTitle from "@/components/page-title";
import ProjectNotFound from "@/components/project/project-not-found";
import { useRescheduleWorkItem } from "@/components/work-item/work-item-calendar-reschedule";
import {
  ScheduleSelectionBar,
  ScheduleSelectionToggle,
  useScheduleSelection,
} from "@/components/work-item/work-item-calendar-selection";
import WorkItemSidePane from "@/components/work-item/work-item-side-pane";
import { shortcuts } from "@/constants/shortcuts";
import useProjectByKey from "@/hooks/queries/agile/use-project-by-key";
import { useScheduleProject } from "@/hooks/queries/work-item/use-schedule-project";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { authClient } from "@/lib/auth-client";
import { filterProjectTasks } from "@/lib/filter-project-tasks";
import {
  type CalendarView,
  type ProjectCalendarSearch,
  parseProjectCalendarSearch,
} from "@/lib/project-board-search";
import {
  projectViewFiltersFromSearch,
  withProjectViewState,
} from "@/lib/project-board-search-state";
import {
  buildCalendarRange,
  calendarAnchorDay,
  dateFromCalendarMonth,
  shiftCalendarSearch,
  switchCalendarView,
} from "@/lib/project-calendar-state";
import { createProjectViewShortcutHandlers } from "@/lib/project-layout-navigation";
import {
  getProjectLayoutStorage,
  writeProjectLayoutPreference,
} from "@/lib/project-layout-preference";
import { toScheduledTasks } from "@/lib/task-schedule";
import { toast } from "@/lib/toast";
import { useUserPreferencesStore } from "@/store/user-preferences";

/**
 * The project's Calendar tab (Kaneo's calendar) at its canonical `/agent` address. It renders only
 * while `feature.calendar` is on for the project (P4R1-M2). The screen keeps its own project
 * header, because the search field sits in it, so the agent shell hands this path no frame.
 * Kaneo's `/dashboard/workspace/{id}/project/{id}/calendar` link redirects here.
 */
export const Route = createFileRoute(
  "/_layout/_authenticated/agent/projects/$projectKey/calendar",
)({
  component: GatedRouteComponent,
  validateSearch: parseProjectCalendarSearch,
});

// Lanes are capped so a busy week cannot push a row taller than the viewport;
// anything past the cap surfaces as a per-day overflow hint. A week or day has the whole
// viewport to itself, so it shows more lanes.
const MAX_LANES_DESKTOP = 3;
const MAX_LANES_MOBILE = 2;
const MAX_LANES_RANGE = 12;

/** P4R1-M2: the view renders only while its feature flag is on for the project. */
function GatedRouteComponent() {
  const { projectKey } = Route.useParams();
  const { project, isLoading } = useProjectByKey(projectKey);
  if (!project)
    return (
      <WorkspaceLayout title={projectKey}>
        {isLoading ? (
          <div className="p-4">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <ProjectNotFound />
        )}
      </WorkspaceLayout>
    );
  return (
    <ProjectViewFeatureGate
      projectId={project.id}
      workspaceId={project.workspaceId}
      view="calendar"
    >
      <RouteComponent
        projectKey={projectKey}
        projectId={project.id}
        workspaceId={project.workspaceId}
      />
    </ProjectViewFeatureGate>
  );
}

function RouteComponent({
  projectKey,
  projectId,
  workspaceId,
}: {
  projectKey: string;
  projectId: string;
  workspaceId: string;
}) {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const { taskId, month } = search;
  const view: CalendarView = search.calendarView ?? "month";
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const {
    data: project,
    isLoading,
    isError,
    refetch,
  } = useScheduleProject(projectId, workspaceId, search.filter);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const permission = useWorkspacePermission(workspaceId, projectId);
  const reschedule = useRescheduleWorkItem(projectId);
  const canReschedule =
    !permission.isCheckingPermissions && permission.canUpdateTasks();
  const handleReschedule = useCallback(
    (task: Parameters<typeof reschedule.mutate>[0]["task"], dayShift: number) =>
      reschedule.mutate(
        { task, dayShift },
        { onError: () => toast.error(t("workItems:journey.saveError")) },
      ),
    [reschedule, t],
  );
  const isMobile = useIsMobile();
  const visibleMonth = useMemo(
    () => dateFromCalendarMonth(month ?? "", startOfMonth(new Date())),
    [month],
  );

  const filters = projectViewFiltersFromSearch(search);
  const scheduledTasks = useMemo(() => {
    if (!project) return [];
    const filterOptions = {
      filters,
      query: search.q,
      projectSlug: project.slug,
      weekStartsOn,
    };
    return toScheduledTasks({
      ...project,
      columns: project.columns.map((column) => ({
        ...column,
        tasks: filterProjectTasks(column.tasks, filterOptions),
      })),
      plannedTasks: filterProjectTasks(
        project.plannedTasks ?? [],
        filterOptions,
      ),
    });
  }, [filters, project, search.q, weekStartsOn]);

  const isFiltered =
    buildScheduleFilterChips(search).length > 0 || Boolean(search.q?.trim());
  const viewStatus = scheduleViewStatus({
    isLoading,
    isError,
    isEmpty: scheduledTasks.length === 0,
  });

  // `VW-25`: the week and day views are anchored on the URL's `date` (else today); the month
  // view keeps its own `month`. A week or day is one row of the same grid.
  const anchorDate = search.date;
  const anchor = useMemo(
    () => calendarAnchorDay({ date: anchorDate }, new Date()),
    [anchorDate],
  );
  const weeks = useMemo(
    () =>
      view === "month"
        ? buildMonthWeeks(visibleMonth, weekStartsOn)
        : buildCalendarRange(view, anchor, weekStartsOn),
    [anchor, view, visibleMonth, weekStartsOn],
  );
  const gridMonth = view === "month" ? visibleMonth : anchor;

  // Select all, and the selection itself, only reach what the visible weeks show.
  const visibleKeys = useMemo(
    () => tasksInWeeks(weeks, scheduledTasks).map((task) => task.id),
    [weeks, scheduledTasks],
  );
  const selection = useScheduleSelection({
    projectId,
    allKeys: visibleKeys,
    paneOpen: Boolean(taskId),
  });

  const handlePreviousMonth = useCallback(() => {
    navigate({
      to: "/agent/projects/$projectKey/calendar",
      params: { projectKey },
      search: (previous: ProjectCalendarSearch) =>
        shiftCalendarSearch(previous, view, visibleMonth, anchor, -1),
    });
  }, [anchor, navigate, projectKey, view, visibleMonth]);

  const handleNextMonth = useCallback(() => {
    navigate({
      to: "/agent/projects/$projectKey/calendar",
      params: { projectKey },
      search: (previous: ProjectCalendarSearch) =>
        shiftCalendarSearch(previous, view, visibleMonth, anchor, 1),
    });
  }, [anchor, navigate, projectKey, view, visibleMonth]);

  const handleToday = useCallback(() => {
    navigate({
      to: "/agent/projects/$projectKey/calendar",
      params: { projectKey },
      search: (previous: ProjectCalendarSearch) =>
        withProjectViewState(previous, { month: undefined, date: undefined }),
    });
  }, [navigate, projectKey]);

  const handleViewChange = useCallback(
    (next: CalendarView) => {
      navigate({
        to: "/agent/projects/$projectKey/calendar",
        params: { projectKey },
        search: (previous: ProjectCalendarSearch) =>
          switchCalendarView(
            previous,
            view,
            next,
            visibleMonth,
            anchor,
            new Date(),
          ),
      });
    },
    [anchor, navigate, projectKey, view, visibleMonth],
  );

  const updateQuery = useCallback(
    (q: string) => {
      navigate({
        to: "/agent/projects/$projectKey/calendar",
        params: { projectKey },
        search: (previous: ProjectCalendarSearch) =>
          withProjectViewState(previous, { q: q || undefined }),
        replace: true,
      });
    },
    [navigate, projectKey],
  );

  const handleOpenTask = useCallback(
    (nextTaskId: string) => {
      if (selection.active) {
        selection.toggleKey(nextTaskId);
        return;
      }
      navigate({
        to: "/agent/projects/$projectKey/calendar",
        params: { projectKey },
        search: (previous: ProjectCalendarSearch) =>
          withProjectViewState(previous, { taskId: nextTaskId }),
        replace: true,
      });
    },
    [navigate, projectKey, selection],
  );

  const handleCloseTaskSheet = useCallback(() => {
    navigate({
      to: "/agent/projects/$projectKey/calendar",
      params: { projectKey },
      search: (previous: ProjectCalendarSearch) =>
        withProjectViewState(previous, { taskId: undefined }),
      replace: true,
    });
  }, [navigate, projectKey]);

  const viewShortcutHandlers = createProjectViewShortcutHandlers(
    { workspaceId, projectId, projectKey: project?.slug },
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
        [shortcuts.view.backlog]: viewShortcutHandlers.backlog,
        [shortcuts.view.gantt]: viewShortcutHandlers.gantt,
        [shortcuts.view.calendar]: () => {},
      },
    },
  });

  return (
    <ProjectLayout
      realtimeMode="canonical"
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="calendar"
      headerActions={
        <ProjectTaskSearchHeader
          value={search.q ?? ""}
          onValueChange={updateQuery}
          placeholder={t("tasks:boardSearchPlaceholder")}
          clearLabel={t("common:actions.clearAll")}
          activeLabel={t("tasks:boardSearchActive")}
        />
      }
    >
      <PageTitle
        title={t("tasks:calendar.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="flex h-full min-h-0 flex-col bg-background">
        <CalendarToolbar
          visibleMonth={gridMonth}
          anchor={anchor}
          rangeDays={weeks[0]}
          view={view}
          onViewChange={handleViewChange}
          onPreviousMonth={handlePreviousMonth}
          onNextMonth={handleNextMonth}
          onToday={handleToday}
          actions={
            <ScheduleSelectionToggle
              workspaceId={workspaceId}
              projectId={projectId}
              selection={selection}
            />
          }
        />
        <ScheduleSelectionBar
          workspaceId={workspaceId}
          projectId={projectId}
          selection={selection}
        />

        <ScheduleFilterChips
          search={search}
          onChange={(patch) =>
            navigate({
              to: "/agent/projects/$projectKey/calendar",
              params: { projectKey },
              search: (previous: ProjectCalendarSearch) =>
                withProjectViewState(previous, patch),
              replace: true,
            })
          }
        />

        {viewStatus === "loading" || viewStatus === "error" ? (
          <ScheduleViewState
            layout="calendar"
            status={viewStatus}
            isFiltered={isFiltered}
            onRetry={() => void refetch()}
          />
        ) : (
          <>
            {viewStatus === "empty" ? (
              <ScheduleViewState
                layout="calendar"
                status="empty"
                isFiltered={isFiltered}
                onRetry={() => void refetch()}
                compact
              />
            ) : null}
            <MonthGrid
              weeks={weeks}
              tasks={scheduledTasks}
              visibleMonth={gridMonth}
              maxLanes={
                view !== "month"
                  ? MAX_LANES_RANGE
                  : isMobile
                    ? MAX_LANES_MOBILE
                    : MAX_LANES_DESKTOP
              }
              projectSlug={project?.slug}
              onOpenTask={handleOpenTask}
              onReschedule={
                // A day has one column, so there is nowhere to drag a bar to; the date
                // editor in the detail pane is the way to move it (`VW-30`).
                canReschedule && !selection.selectionMode && view !== "day"
                  ? handleReschedule
                  : undefined
              }
              selectionMode={selection.active}
              selectedIds={selection.selectedKeys}
            />
          </>
        )}

        <WorkItemSidePane itemKey={taskId} onClose={handleCloseTaskSheet} />
      </div>
    </ProjectLayout>
  );
}
