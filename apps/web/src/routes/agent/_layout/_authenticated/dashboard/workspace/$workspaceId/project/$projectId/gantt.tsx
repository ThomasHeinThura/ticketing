import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button, Toggle, useIsMobile } from "@taskdesk/ui";
import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  isWeekend,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";
import { Calendar, ChevronLeft, ChevronRight, Workflow } from "lucide-react";
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
import ScheduleFilterChips, {
  buildScheduleFilterChips,
} from "@/components/calendar/schedule-filter-chips";
import ScheduleViewState, {
  scheduleViewStatus,
} from "@/components/calendar/schedule-view-state";
import GroupControl from "@/components/common/group-control";
import ProjectLayout from "@/components/common/project-layout";
import ProjectTaskSearchInput from "@/components/common/project-task-search-input";
import { CanonicalGanttTaskBar } from "@/components/gantt/canonical-gantt-task-bar";
import {
  type ArrowPath,
  type BarBox,
  buildArrowPaths,
  GanttDependencyArrows,
} from "@/components/gantt/gantt-dependency-arrows";
import { buildGanttRows } from "@/components/gantt/gantt-groups";
import PageTitle from "@/components/page-title";
import {
  ScheduleSelectionBar,
  ScheduleSelectionToggle,
  useScheduleSelection,
} from "@/components/work-item/work-item-calendar-selection";
import WorkItemSidePane from "@/components/work-item/work-item-side-pane";
import { getDependencies, getModules } from "@/fetchers/agile";
import useAgileFeatures from "@/hooks/queries/agile/use-agile-features";
import { useScheduleProject } from "@/hooks/queries/work-item/use-schedule-project";
import { cn } from "@/lib/cn";
import { filterProjectTasks } from "@/lib/filter-project-tasks";
import { getStatusLabel } from "@/lib/i18n/domain";
import { parseProjectBoardSearch } from "@/lib/project-board-search";
import {
  projectViewFiltersFromSearch,
  withProjectBoardTask,
  withProjectViewState,
} from "@/lib/project-board-search-state";
import { PROJECT_GANTT_PATH } from "@/lib/routes";
import { useUserPreferencesStore } from "@/store/user-preferences";

const SelectionCheckbox = lazy(
  () => import("@/components/work-item/selection-checkbox"),
);

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/gantt",
)({
  component: RouteComponent,
  validateSearch: parseProjectBoardSearch,
});

function parseTaskDate(value: string | null) {
  if (!value) return null;
  const parsed = parseISO(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const { taskId } = search;
  const navigate = useNavigate();
  const {
    data: project,
    isLoading,
    isError,
    refetch,
  } = useScheduleProject(projectId, workspaceId, search.filter);
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const searchQuery = search.q ?? "";
  const filters = projectViewFiltersFromSearch(search);
  const isMobile = useIsMobile();
  const [isTaskRailOpen, setIsTaskRailOpen] = useState(false);

  // Wider day columns on small screens so dragging and reading dates is easier.
  const dayColumnWidthRem = isMobile ? 3.125 : 2.75;
  const taskColumnWidthRem = isMobile ? 12 : 14;
  const showTaskRail = !isMobile || isTaskRailOpen;
  const timelineTrackRef = useRef<HTMLDivElement>(null);
  const [pixelsPerDay, setPixelsPerDay] = useState(44);
  const todayCellRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll once per visit to the view: re-running on every timeline
  // recalculation (e.g. a browser resize crossing the mobile breakpoint) would
  // yank the grid back to today out from under someone who deliberately
  // scrolled elsewhere.
  const hasCenteredOnTodayRef = useRef(false);
  // The Gantt project selector can swap `projectId` without unmounting this
  // route, so the one-time guard above has to be re-armed for the newly
  // selected project. Resetting it here (during render, comparing against the
  // previous projectId) rather than in an effect means it's already cleared
  // by the time the auto-center layout effect below runs for this project,
  // instead of one render later.
  const previousProjectIdRef = useRef(projectId);
  if (previousProjectIdRef.current !== projectId) {
    previousProjectIdRef.current = projectId;
    hasCenteredOnTodayRef.current = false;
  }

  useEffect(() => {
    if (!isMobile) {
      setIsTaskRailOpen(true);
      return;
    }

    setIsTaskRailOpen(false);
  }, [isMobile]);

  const allTasks = useMemo(
    () => [
      ...(project?.columns.flatMap((column) => column.tasks) ?? []),
      ...(project?.plannedTasks ?? []),
    ],
    [project],
  );

  const parsedTasks = useMemo(() => {
    return allTasks
      .map((task) => {
        const parsedStart =
          parseTaskDate(task.startDate) ?? parseTaskDate(task.dueDate);
        const parsedEnd =
          parseTaskDate(task.dueDate) ?? parseTaskDate(task.startDate);

        if (!parsedStart || !parsedEnd) return null;

        const start = parsedStart <= parsedEnd ? parsedStart : parsedEnd;
        const end = parsedEnd >= parsedStart ? parsedEnd : parsedStart;

        return {
          ...task,
          scheduleStart: start,
          scheduleEnd: end,
        };
      })
      .filter((task): task is NonNullable<typeof task> => task !== null)
      .sort(
        (left, right) =>
          left.scheduleStart.getTime() - right.scheduleStart.getTime(),
      );
  }, [allTasks]);

  const scheduledTasks = useMemo(
    () =>
      filterProjectTasks(parsedTasks, {
        filters,
        query: searchQuery,
        projectSlug: project?.slug,
        weekStartsOn,
        matchStatusText: true,
      }),
    [filters, parsedTasks, project?.slug, searchQuery, weekStartsOn],
  );

  // `VW-27`: group the bars by assignee, or by module when `feature.modules` is on. It lives in
  // the URL; a `group=module` link on a project without modules shows no grouping.
  const { features } = useAgileFeatures(projectId);
  const group =
    search.group === "assignee"
      ? "assignee"
      : search.group === "module" && features.modules
        ? "module"
        : "none";
  const modulesQuery = useQuery({
    queryKey: ["agile", "modules", project?.slug],
    queryFn: () => getModules(project?.slug as string),
    enabled: group === "module" && Boolean(project?.slug),
    retry: false,
  });
  const moduleNames = useMemo(
    () =>
      new Map((modulesQuery.data?.data ?? []).map((mod) => [mod.id, mod.name])),
    [modulesQuery.data],
  );
  const ganttRows = useMemo(
    () => buildGanttRows(scheduledTasks, group, moduleNames),
    [scheduledTasks, group, moduleNames],
  );

  // `VW-28`: dependency arrows are toggleable and off by default (`deps=1` in the URL).
  const showDependencies = search.deps === "1";
  const dependencies = useQuery({
    queryKey: ["agile", "dependencies", project?.slug],
    queryFn: () => getDependencies(project?.slug as string),
    enabled: showDependencies && Boolean(project?.slug),
    retry: false,
  });

  const hasFilterChips = buildScheduleFilterChips(search).length > 0;
  const loadStatus = scheduleViewStatus({
    isLoading,
    isError,
    isEmpty: false,
  });

  const updateViewState = useCallback(
    (patch: Parameters<typeof withProjectViewState>[1]) => {
      navigate({
        to: PROJECT_GANTT_PATH,
        params: { workspaceId, projectId },
        search: (previous: ReturnType<typeof parseProjectBoardSearch>) =>
          withProjectViewState(previous, patch),
        replace: true,
      });
    },
    [navigate, projectId, workspaceId],
  );

  const handleOpenTask = useCallback(
    (nextTaskId: string | undefined) => {
      navigate({
        to: PROJECT_GANTT_PATH,
        params: { workspaceId, projectId },
        search: (previous: ReturnType<typeof parseProjectBoardSearch>) =>
          withProjectBoardTask(previous, nextTaskId),
        replace: true,
      });
    },
    [navigate, projectId, workspaceId],
  );

  const selection = useScheduleSelection({
    projectId,
    allKeys: useMemo(
      () => scheduledTasks.map((task) => task.id),
      [scheduledTasks],
    ),
    paneOpen: Boolean(taskId),
  });
  const handleActivateTask = useCallback(
    (key: string) => {
      if (selection.active) selection.toggleKey(key);
      else handleOpenTask(key);
    },
    [handleOpenTask, selection],
  );

  const timeline = useMemo(() => {
    if (parsedTasks.length === 0) return null;

    const earliest = parsedTasks.reduce(
      (current, task) =>
        task.scheduleStart < current ? task.scheduleStart : current,
      parsedTasks[0].scheduleStart,
    );
    const latest = parsedTasks.reduce(
      (current, task) =>
        task.scheduleEnd > current ? task.scheduleEnd : current,
      parsedTasks[0].scheduleEnd,
    );

    // Week-aligned bounds around task dates, then pad with extra days so bars can
    // be resized or moved past the current last task without running out of grid.
    const weekStart = startOfWeek(earliest, { weekStartsOn });
    const weekEnd = endOfWeek(latest, { weekStartsOn });
    const rangeStart = subDays(weekStart, 7);
    const rangeEnd = addDays(weekEnd, 28);

    const days = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

    return {
      days,
      rangeStart,
      gridTemplateColumns: `repeat(${days.length}, minmax(${dayColumnWidthRem}rem, ${dayColumnWidthRem}rem))`,
      timelineMinWidthRem: days.length * dayColumnWidthRem,
    };
  }, [parsedTasks, dayColumnWidthRem, weekStartsOn]);

  // Whether "today" actually falls inside the computed date range. A project
  // made up entirely of past or far-future tasks has no "today" column to
  // jump to, so the button below is disabled in that case instead of doing
  // nothing silently.
  const todayInRange = useMemo(
    () => timeline?.days.some((day) => isToday(day)) ?? false,
    [timeline],
  );

  // The task rail is `position: sticky; left: 0`, so it stays pinned over the
  // left edge of the scroll container's viewport rather than scrolling away
  // with the timeline underneath it. `scrollIntoView({ inline: "center" })`
  // has no way to know that, and centers the target against the *whole*
  // viewport width, landing today roughly half the rail's width left of
  // where it visually reads as centered. `scroll-padding-left` tells the
  // browser's own scroll-alignment math to treat the rail's width as inset
  // from the viewport, so "center" (and any future "start"/"end" alignment)
  // resolves against the space actually visible next to it.
  const scrollPaddingLeftRem = showTaskRail
    ? isMobile
      ? taskColumnWidthRem
      : 20
    : 0;

  const scrollToToday = useCallback((behavior: ScrollBehavior = "smooth") => {
    todayCellRef.current?.scrollIntoView({
      behavior,
      inline: "center",
      block: "nearest",
    });
  }, []);

  useLayoutEffect(() => {
    const element = timelineTrackRef.current;
    if (!element || !timeline) return;

    const update = () => {
      const count = timeline.days.length;
      if (count <= 0) return;
      setPixelsPerDay(element.clientWidth / count);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [timeline]);

  // `VW-28`: arrows are measured from the rendered rows (rows vary in height) and the day grid, so
  // they stay attached to the bars after a resize, a regroup or a filter.
  const rowsRef = useRef<HTMLDivElement>(null);
  const [arrowLayout, setArrowLayout] = useState<{
    paths: ArrowPath[];
    left: number;
    width: number;
    height: number;
  } | null>(null);
  const dependencyEdges = dependencies.data;
  // `scheduledTasks` is a new array on most renders, so the effect reads it through a ref and
  // re-measures on a signature of the visible rows instead: depending on the array itself would
  // set state on every render.
  const scheduledTasksRef = useRef(scheduledTasks);
  scheduledTasksRef.current = scheduledTasks;
  const rowsSignature = ganttRows
    .map((row) => (row.kind === "task" ? row.task.id : row.id))
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: rowsSignature, showTaskRail and isMobile change the row layout the measurement reads.
  useLayoutEffect(() => {
    const container = rowsRef.current;
    const track = timelineTrackRef.current;
    if (
      !showDependencies ||
      !timeline ||
      !dependencyEdges ||
      !container ||
      !track
    ) {
      setArrowLayout(null);
      return;
    }
    const dates = new Map(
      scheduledTasksRef.current.map((task) => [
        task.id,
        { start: task.scheduleStart, end: task.scheduleEnd },
      ]),
    );
    const measure = () => {
      const bars = new Map<string, BarBox>();
      for (const row of container.querySelectorAll<HTMLElement>(
        "[data-gantt-row]",
      )) {
        const key = row.dataset.ganttRow;
        const range = key ? dates.get(key) : undefined;
        if (!key || !range) continue;
        const startIndex = differenceInCalendarDays(
          range.start,
          timeline.rangeStart,
        );
        const endIndex = differenceInCalendarDays(
          range.end,
          timeline.rangeStart,
        );
        bars.set(key, {
          left: startIndex * pixelsPerDay + 4,
          right: (endIndex + 1) * pixelsPerDay - 4,
          top: row.offsetTop,
          bottom: row.offsetTop + row.offsetHeight,
        });
      }
      const next = {
        paths: buildArrowPaths(dependencyEdges, bars),
        left: track.offsetLeft,
        width: track.offsetWidth,
        height: container.offsetHeight,
      };
      setArrowLayout((previous) =>
        previous && JSON.stringify(previous) === JSON.stringify(next)
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [
    showDependencies,
    timeline,
    dependencyEdges,
    rowsSignature,
    pixelsPerDay,
    showTaskRail,
    isMobile,
  ]);

  // Center the view on today the first time it becomes available, so opening
  // the Gantt chart on a long-running project doesn't drop you at the start
  // of the timeline with today scrolled off-screen. `projectId` is listed as
  // a dependency (even though the effect body doesn't use it directly)
  // because switching projects can leave `todayInRange` unchanged (true on
  // both the old and new project) while still resetting the one-time guard
  // above during render — without `projectId` here, React would bail out of
  // re-running this effect since neither `todayInRange` nor `scrollToToday`
  // actually changed value, and the newly selected project would never get
  // its auto-center.
  // biome-ignore lint/correctness/useExhaustiveDependencies: projectId is intentionally listed to force a re-run on project switch; see comment above.
  useLayoutEffect(() => {
    if (
      hasCenteredOnTodayRef.current ||
      !todayInRange ||
      scheduledTasks.length === 0 ||
      !todayCellRef.current
    )
      return;
    hasCenteredOnTodayRef.current = true;
    scrollToToday("auto");
  }, [todayInRange, scrollToToday, projectId, scheduledTasks.length]);

  return (
    <ProjectLayout
      realtimeMode="canonical"
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="gantt"
    >
      <PageTitle
        title={t("tasks:gantt.pageTitle", { name: project?.name })}
        hideAppName
      />
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="border-b border-border/80 px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <h1 className="text-sm font-semibold text-foreground">
                {t("tasks:gantt.title")}
              </h1>
            </div>

            <ProjectTaskSearchInput
              value={searchQuery}
              onValueChange={(q) => updateViewState({ q: q || undefined })}
              placeholder={t("tasks:gantt.searchPlaceholder")}
              clearLabel={t("common:actions.clearAll")}
            />

            <GroupControl
              group={group === "none" ? "state" : group}
              groups={
                features.modules
                  ? (["state", "assignee", "module"] as const)
                  : (["state", "assignee"] as const)
              }
              defaultLabel={t("tasks:group.none")}
              onGroupChange={(next) =>
                updateViewState({
                  group: next === "state" ? undefined : next,
                })
              }
            />

            <Toggle
              size="sm"
              variant="outline"
              pressed={showDependencies}
              onPressedChange={(pressed) =>
                updateViewState({ deps: pressed ? "1" : undefined })
              }
              aria-label={t("tasks:gantt.dependencies.toggle")}
            >
              <Workflow className="size-3.5" aria-hidden="true" />
              {t("tasks:gantt.dependencies.toggle")}
            </Toggle>

            <ScheduleSelectionToggle
              workspaceId={workspaceId}
              projectId={projectId}
              selection={selection}
            />

            <Button
              variant="outline"
              size="xs"
              className="min-h-11 touch-manipulation sm:min-h-0"
              onClick={() => scrollToToday()}
              disabled={!todayInRange || scheduledTasks.length === 0}
            >
              <Calendar className="size-3.5" />
              {t("tasks:gantt.jumpToToday")}
            </Button>

            <Button
              variant="outline"
              size="xs"
              className="min-h-11 touch-manipulation sm:hidden"
              onClick={() => setIsTaskRailOpen((current) => !current)}
            >
              {showTaskRail ? (
                <ChevronLeft className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              {showTaskRail
                ? t("tasks:gantt.hideTasks")
                : t("tasks:gantt.showTasks")}
            </Button>
          </div>
        </div>

        <ScheduleSelectionBar
          workspaceId={workspaceId}
          projectId={projectId}
          selection={selection}
        />

        <ScheduleFilterChips
          search={search}
          onChange={(patch) => updateViewState(patch)}
        />

        {loadStatus === "loading" || loadStatus === "error" ? (
          <ScheduleViewState
            layout="gantt"
            status={loadStatus}
            isFiltered={false}
            onRetry={() => void refetch()}
          />
        ) : !timeline || parsedTasks.length === 0 ? (
          <ScheduleViewState
            layout="gantt"
            status="empty"
            isFiltered={hasFilterChips}
            onRetry={() => void refetch()}
          />
        ) : scheduledTasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <h2 className="text-sm font-semibold text-foreground">
                {t("tasks:gantt.noTasksFound")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("tasks:gantt.noTasksMatch", { query: searchQuery })}
              </p>
            </div>
          </div>
        ) : (
          <div
            data-testid="gantt-scroll-container"
            className="min-h-0 flex-1 overflow-auto overscroll-x-contain [-webkit-overflow-scrolling:touch]"
            style={{ scrollPaddingLeft: `${scrollPaddingLeftRem}rem` }}
          >
            <div className="relative min-w-max touch-pan-x touch-pan-y">
              <div className="sticky top-0 z-20 flex border-b border-border bg-background/95 backdrop-blur">
                {showTaskRail ? (
                  <div
                    className="sticky left-0 z-30 shrink-0 border-r border-border bg-background px-2 py-2.5 sm:w-80 sm:px-4 sm:py-3"
                    style={{
                      width: isMobile ? `${taskColumnWidthRem}rem` : undefined,
                    }}
                  >
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t("tasks:gantt.taskHeader")}
                    </p>
                  </div>
                ) : null}
                <div
                  className="grid shrink-0"
                  style={{
                    gridTemplateColumns: timeline.gridTemplateColumns,
                    minWidth: `${timeline.timelineMinWidthRem}rem`,
                  }}
                >
                  {timeline.days.map((day, index) => {
                    const showMonth =
                      index === 0 ||
                      !isSameMonth(day, timeline.days[index - 1] ?? day);

                    const isCurrentDay = isToday(day);

                    return (
                      <div
                        key={day.toISOString()}
                        ref={isCurrentDay ? todayCellRef : undefined}
                        className={cn(
                          "border-r border-border/70 px-0.5 py-2 text-center sm:px-1",
                          isWeekend(day) && "bg-muted/25",
                        )}
                      >
                        <div className="h-4 text-[10px] font-medium text-muted-foreground">
                          {showMonth ? format(day, "MMM") : ""}
                        </div>
                        <div
                          className={cn(
                            "mx-auto flex size-6 items-center justify-center rounded-full text-xs font-medium",
                            isCurrentDay &&
                              "bg-primary text-primary-foreground",
                          )}
                        >
                          {format(day, "d")}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="relative">
                <div
                  ref={timelineTrackRef}
                  className="absolute inset-y-0 z-0 grid"
                  style={{
                    left: showTaskRail
                      ? isMobile
                        ? `${taskColumnWidthRem}rem`
                        : "20rem"
                      : "0rem",
                    gridTemplateColumns: timeline.gridTemplateColumns,
                    width: `${timeline.timelineMinWidthRem}rem`,
                  }}
                >
                  {timeline.days.map((day) => (
                    <div
                      key={`bg-line-${day.toISOString()}`}
                      className={cn(
                        "h-full min-h-0 border-r border-border/60",
                        isWeekend(day) && "bg-muted/25",
                      )}
                    />
                  ))}
                </div>

                <div ref={rowsRef} className="relative z-10 flex flex-col">
                  {arrowLayout ? (
                    <div
                      className="pointer-events-none absolute top-0"
                      style={{ left: arrowLayout.left }}
                    >
                      <GanttDependencyArrows
                        paths={arrowLayout.paths}
                        width={arrowLayout.width}
                        height={arrowLayout.height}
                        label={t("tasks:gantt.dependencies.label")}
                      />
                    </div>
                  ) : null}
                  {ganttRows.map((row) => {
                    if (row.kind === "group") {
                      return (
                        <div
                          key={row.id}
                          data-testid="gantt-group-row"
                          className="grid items-stretch border-b border-border/70 bg-muted/40"
                          style={{
                            gridTemplateColumns: showTaskRail
                              ? isMobile
                                ? `${taskColumnWidthRem}rem max-content`
                                : "20rem max-content"
                              : "max-content",
                          }}
                        >
                          {showTaskRail ? (
                            <div className="sticky left-0 z-[11] flex items-center gap-2 border-r border-border bg-muted px-2 py-1.5 sm:px-3">
                              <h2 className="truncate text-[11px] font-medium uppercase tracking-wide text-foreground">
                                {row.name ??
                                  t(
                                    row.by === "module"
                                      ? "tasks:gantt.noModule"
                                      : "tasks:gantt.unassigned",
                                  )}
                              </h2>
                              <span className="rounded-md bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {row.count}
                              </span>
                            </div>
                          ) : null}
                          <div
                            className="shrink-0"
                            style={{
                              minWidth: `${timeline.timelineMinWidthRem}rem`,
                            }}
                          />
                        </div>
                      );
                    }
                    const task = row.task;
                    return (
                      <div
                        key={task.id}
                        data-gantt-row={task.id}
                        className="grid items-stretch border-b border-border/70"
                        style={{
                          gridTemplateColumns: showTaskRail
                            ? isMobile
                              ? `${taskColumnWidthRem}rem max-content`
                              : "20rem max-content"
                            : "max-content",
                        }}
                      >
                        {showTaskRail ? (
                          <div
                            className={cn(
                              "sticky left-0 z-[11] flex h-full items-center border-r border-border bg-background",
                              selection.selectedKeys.includes(task.id) &&
                                "bg-accent/35",
                            )}
                          >
                            {selection.active ? (
                              <Suspense fallback={null}>
                                <SelectionCheckbox
                                  className="ml-2 shrink-0"
                                  aria-label={t("workItems:bulk.selectItem", {
                                    key: `${project?.slug}-${task.number}`,
                                  })}
                                  checked={selection.selectedKeys.includes(
                                    task.id,
                                  )}
                                  onCheckedChange={() =>
                                    selection.toggleKey(task.id)
                                  }
                                />
                              </Suspense>
                            ) : null}
                            <Button
                              variant="ghost"
                              type="button"
                              className="flex min-h-[44px] w-full min-w-0 flex-col items-start justify-center gap-0.5 px-2 py-2 text-left transition-colors hover:bg-muted sm:min-h-0 sm:px-3 sm:py-1.5"
                              onClick={() => handleActivateTask(task.id)}
                            >
                              <div className="flex w-full items-center gap-1.5">
                                <span className="max-w-[7rem] truncate rounded-full bg-secondary px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-secondary-foreground sm:max-w-none">
                                  {getStatusLabel(task.status)}
                                </span>
                                <span className="truncate text-[10px] text-muted-foreground">
                                  {project?.slug}-{task.number}
                                </span>
                              </div>
                              <p className="w-full line-clamp-1 text-xs font-medium leading-tight text-foreground">
                                {task.title}
                              </p>
                              <p className="w-full truncate text-[11px] leading-tight text-muted-foreground">
                                {format(task.scheduleStart, "MMM d")} -{" "}
                                {format(task.scheduleEnd, "MMM d")}
                                {task.assigneeName
                                  ? ` • ${task.assigneeName}`
                                  : ""}
                              </p>
                            </Button>
                          </div>
                        ) : null}

                        <div
                          className="relative min-h-11 shrink-0 select-none"
                          style={{
                            minWidth: `${timeline.timelineMinWidthRem}rem`,
                          }}
                        >
                          <CanonicalGanttTaskBar
                            workspaceId={workspaceId}
                            task={task}
                            timeline={timeline}
                            pixelsPerDay={pixelsPerDay}
                            isMobile={isMobile}
                            onOpenTask={() => handleActivateTask(task.id)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        <WorkItemSidePane
          itemKey={taskId}
          onClose={() => handleOpenTask(undefined)}
        />
      </div>
    </ProjectLayout>
  );
}
