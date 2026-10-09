import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useIsMobile } from "@taskdesk/ui";
import { startOfMonth } from "date-fns";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import CalendarToolbar from "@/components/calendar/calendar-toolbar";
import MonthGrid from "@/components/calendar/month-grid";
import { buildMonthWeeks } from "@/components/calendar/month-grid-model";
import ProjectLayout from "@/components/common/project-layout";
import ProjectTaskSearchInput from "@/components/common/project-task-search-input";
import PageTitle from "@/components/page-title";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import { shortcuts } from "@/constants/shortcuts";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { authClient } from "@/lib/auth-client";
import { filterProjectTasks } from "@/lib/filter-project-tasks";
import {
  projectViewFiltersFromSearch,
  withProjectViewState,
} from "@/lib/project-board-search";
import {
  dateFromCalendarMonth,
  type ProjectCalendarSearch,
  parseProjectCalendarSearch,
  shiftCalendarMonthSearch,
  withCalendarMonth,
  withCalendarTask,
} from "@/lib/project-calendar-search";
import { createProjectViewShortcutHandlers } from "@/lib/project-layout-navigation";
import {
  getProjectLayoutStorage,
  writeProjectLayoutPreference,
} from "@/lib/project-layout-preference";
import { routes } from "@/lib/routes";
import { toScheduledTasks } from "@/lib/task-schedule";
import { useUserPreferencesStore } from "@/store/user-preferences";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/calendar",
)({
  component: RouteComponent,
  validateSearch: parseProjectCalendarSearch,
});

// Lanes are capped so a busy week cannot push a row taller than the viewport;
// anything past the cap surfaces as a per-day overflow hint.
const MAX_LANES_DESKTOP = 3;
const MAX_LANES_MOBILE = 2;

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const { taskId, month } = search;
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const { data: project, isLoading, isError } = useGetTasks(projectId);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
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

  const weeks = useMemo(
    () => buildMonthWeeks(visibleMonth, weekStartsOn),
    [visibleMonth, weekStartsOn],
  );

  const handlePreviousMonth = useCallback(() => {
    navigate({
      to: routes.projectCalendar.path,
      params: { workspaceId, projectId },
      search: (previous: ProjectCalendarSearch) =>
        shiftCalendarMonthSearch(previous, visibleMonth, -1),
    });
  }, [navigate, projectId, visibleMonth, workspaceId]);

  const handleNextMonth = useCallback(() => {
    navigate({
      to: routes.projectCalendar.path,
      params: { workspaceId, projectId },
      search: (previous: ProjectCalendarSearch) =>
        shiftCalendarMonthSearch(previous, visibleMonth, 1),
    });
  }, [navigate, projectId, visibleMonth, workspaceId]);

  const handleToday = useCallback(() => {
    navigate({
      to: routes.projectCalendar.path,
      params: { workspaceId, projectId },
      search: (previous: ProjectCalendarSearch) =>
        withCalendarMonth(previous, undefined),
    });
  }, [navigate, projectId, workspaceId]);

  const updateQuery = useCallback(
    (q: string) => {
      navigate({
        to: routes.projectCalendar.path,
        params: { workspaceId, projectId },
        search: (previous: ProjectCalendarSearch) =>
          withProjectViewState(previous, { q: q || undefined }),
        replace: true,
      });
    },
    [navigate, projectId, workspaceId],
  );

  const handleOpenTask = useCallback(
    (nextTaskId: string) => {
      navigate({
        to: routes.projectCalendar.path,
        params: { workspaceId, projectId },
        search: (previous: ProjectCalendarSearch) =>
          withCalendarTask(previous, nextTaskId),
        replace: true,
      });
    },
    [navigate, projectId, workspaceId],
  );

  const handleCloseTaskSheet = useCallback(() => {
    navigate({
      to: routes.projectCalendar.path,
      params: { workspaceId, projectId },
      search: (previous: ProjectCalendarSearch) =>
        withCalendarTask(previous, undefined),
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
        [shortcuts.view.backlog]: viewShortcutHandlers.backlog,
        [shortcuts.view.gantt]: viewShortcutHandlers.gantt,
        [shortcuts.view.calendar]: () => {},
      },
    },
  });

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="calendar"
      headerActions={
        <ProjectTaskSearchInput
          value={search.q ?? ""}
          onValueChange={updateQuery}
          placeholder={t("tasks:boardSearchPlaceholder")}
          clearLabel={t("common:actions.clearAll")}
        />
      }
    >
      <PageTitle
        title={t("tasks:calendar.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="flex h-full min-h-0 flex-col bg-background">
        <CalendarToolbar
          visibleMonth={visibleMonth}
          onPreviousMonth={handlePreviousMonth}
          onNextMonth={handleNextMonth}
          onToday={handleToday}
        />

        {isLoading ? (
          <div className="border-b border-border/80 px-4 py-3 text-center">
            <p className="text-sm text-muted-foreground">
              {t("common:empty.loading")}
            </p>
          </div>
        ) : isError ? (
          <div className="border-b border-border/80 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-destructive">
              {t("tasks:calendar.loadError")}
            </p>
          </div>
        ) : scheduledTasks.length === 0 ? (
          <div className="border-b border-border/80 px-4 py-3 text-center">
            <p className="text-sm font-semibold text-foreground">
              {t("tasks:calendar.noTasks")}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("tasks:calendar.noTasksSubtitle")}
            </p>
          </div>
        ) : null}

        <MonthGrid
          weeks={weeks}
          tasks={scheduledTasks}
          visibleMonth={visibleMonth}
          maxLanes={isMobile ? MAX_LANES_MOBILE : MAX_LANES_DESKTOP}
          projectSlug={project?.slug}
          onOpenTask={handleOpenTask}
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
