import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@taskdesk/ui";
import { produce } from "immer";
import { ArrowRight, Calendar, Filter, Plus, User, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/avatar";
import BacklogListView from "@/components/backlog-list-view";
import ProjectLayout from "@/components/common/project-layout";
import ProjectTaskSearchInput from "@/components/common/project-task-search-input";
import SortControl from "@/components/common/sort-control";
import PageTitle from "@/components/page-title";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import TaskDetailsSheet from "@/components/task/task-details-sheet";
import { shortcuts } from "@/constants/shortcuts";
import {
  hasPendingTaskUpdate,
  useUpdateTask,
} from "@/hooks/mutations/task/use-update-task";
import useGetLabelsByWorkspace from "@/hooks/queries/label/use-get-labels-by-workspace";
import { useGetTasks } from "@/hooks/queries/task/use-get-tasks";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { DUE_DATE_FILTER_VALUES } from "@/hooks/use-task-filters";
import { authClient } from "@/lib/auth-client";
import { filterProjectTasks } from "@/lib/filter-project-tasks";
import { getInitials } from "@/lib/get-initials";
import { getPriorityLabel } from "@/lib/i18n/domain";
import { resolveLabelColor } from "@/lib/label-color";
import { getPriorityIcon } from "@/lib/priority";
import {
  type ProjectBacklogSearch,
  parseProjectBacklogSearch,
} from "@/lib/project-board-search";
import {
  projectViewFiltersFromSearch,
  projectViewSortFromSearch,
  withProjectBoardTask,
  withProjectViewFilters,
  withProjectViewSort,
  withProjectViewState,
} from "@/lib/project-board-search-state";
import { createProjectViewShortcutHandlers } from "@/lib/project-layout-navigation";
import {
  getProjectLayoutStorage,
  writeProjectLayoutPreference,
} from "@/lib/project-layout-preference";
import type { SortConfig } from "@/lib/sort-tasks";
import { sortTasks } from "@/lib/sort-tasks";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type Task from "@/types/task";

export const Route = createFileRoute(
  "/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/backlog",
)({
  component: RouteComponent,
  validateSearch: parseProjectBacklogSearch,
});

function RouteComponent() {
  const { t } = useTranslation();
  const { projectId, workspaceId } = Route.useParams();
  const search = Route.useSearch();
  const { taskId } = search;
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = authClient.useSession();
  const { data } = useGetTasks(projectId);
  const { project, setProject } = useProjectStore();
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const { mutate: updateTask } = useUpdateTask();
  const sort = projectViewSortFromSearch(search);
  const filters = projectViewFiltersFromSearch(search);

  const { data: users } = useGetActiveWorkspaceUsers(workspaceId);
  const { data: workspaceLabels = [] } = useGetLabelsByWorkspace(workspaceId);
  const queryClient = useQueryClient();
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);

  const setSort = useCallback(
    (nextSort: SortConfig) => {
      navigate({
        to: ".",
        search: (previous: ProjectBacklogSearch) =>
          withProjectViewSort(previous, nextSort),
      });
    },
    [navigate],
  );

  const updateFilters = useCallback(
    (nextFilters: ReturnType<typeof projectViewFiltersFromSearch>) => {
      navigate({
        to: ".",
        search: (previous: ProjectBacklogSearch) =>
          withProjectViewFilters(previous, nextFilters),
      });
    },
    [navigate],
  );

  const updateQuery = useCallback(
    (q: string) => {
      navigate({
        to: ".",
        search: (previous: ProjectBacklogSearch) =>
          withProjectViewState(previous, { q: q || undefined }),
        replace: true,
      });
    },
    [navigate],
  );

  const handleCloseTaskSheet = useCallback(() => {
    navigate({
      to: ".",
      search: (previous: ProjectBacklogSearch) =>
        withProjectBoardTask(previous, undefined),
      replace: true,
    });
  }, [navigate]);

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
        [shortcuts.view.backlog]: () => {},
      },
    },
  });

  const updateFilter = (
    key: "priority" | "assignee" | "dueDate",
    value: string | null,
    checked = true,
  ) => {
    const currentValues = filters[key] ?? [];
    const nextValues = value
      ? checked
        ? [...new Set([...currentValues, value])]
        : currentValues.filter((item) => item !== value)
      : [];
    updateFilters({
      ...filters,
      [key]: nextValues.length ? nextValues : null,
    });
  };

  const updateLabelFilter = (labelId: string) => {
    const labels = filters.labels ?? [];
    updateFilters({
      ...filters,
      labels: labels.includes(labelId)
        ? labels.filter((id) => id !== labelId)
        : [...labels, labelId],
    });
  };

  const clearFilters = () => {
    updateFilters({
      status: null,
      priority: null,
      assignee: null,
      dueDate: null,
      labels: null,
    });
  };

  const hasActiveFilters = Object.values(filters).some(
    (filter) => filter?.length,
  );

  useEffect(() => {
    if (data && !hasPendingTaskUpdate(queryClient, projectId)) {
      setProject(data);
    }
  }, [data, projectId, queryClient, setProject]);

  const getAssigneeDisplayName = (userId: string) => {
    const member = users?.members?.find((m) => m.userId === userId);
    return member?.user?.name || t("common:people.unknown");
  };

  const getTaskLabels = useCallback(
    (taskId: string) => {
      const queryKey = ["labels", taskId];
      const cachedData = queryClient.getQueryData(queryKey) as
        | Array<{ id: string; name: string; color: string }>
        | undefined;
      return cachedData || [];
    },
    [queryClient],
  );

  const filteredProject = useMemo(() => {
    if (!project) return null;

    const filterTasks = (tasks: Task[]) =>
      filterProjectTasks(tasks, {
        filters: { ...filters, labels: null },
        query: search.q,
        projectSlug: project.slug,
        weekStartsOn,
      }).filter((task) => {
        if (!filters.labels?.length) return true;
        const taskLabelIds = getTaskLabels(task.id).map((label) => label.id);
        return filters.labels.some((filterLabelId) =>
          taskLabelIds.includes(filterLabelId),
        );
      });

    return {
      ...project,
      plannedTasks: filterTasks(project.plannedTasks || []),
      archivedTasks: filterTasks(project.archivedTasks || []),
    };
  }, [project, filters, getTaskLabels, search.q, weekStartsOn]);

  const uniqueLabels = workspaceLabels.reduce(
    (
      acc: { id: string; name: string; color: string }[],
      label: { id: string; name: string; color: string },
    ) => {
      const existing = acc.find(
        (l) => l.name === label.name && l.color === label.color,
      );
      if (!existing) {
        acc.push(label);
      }
      return acc;
    },
    [],
  );

  const isLabelGroupSelected = (label: { name: string; color: string }) => {
    return workspaceLabels
      .filter(
        (l: { name: string; color: string }) =>
          l.name === label.name && l.color === label.color,
      )
      .some((l: { id: string }) => filters.labels?.includes(l.id));
  };

  const toggleLabelGroup = (label: { name: string; color: string }) => {
    const matchingLabels = workspaceLabels.filter(
      (l: { name: string; color: string }) =>
        l.name === label.name && l.color === label.color,
    );

    const isAnySelected = matchingLabels.some((l: { id: string }) =>
      filters.labels?.includes(l.id),
    );

    if (isAnySelected) {
      for (const l of matchingLabels) {
        if (filters.labels?.includes(l.id)) {
          updateLabelFilter(l.id);
        }
      }
    } else {
      for (const l of matchingLabels) {
        if (!filters.labels?.includes(l.id)) {
          updateLabelFilter(l.id);
        }
      }
    }
  };

  const sortedProject = useMemo(() => {
    if (!filteredProject || sort.field === "position") return filteredProject;
    return {
      ...filteredProject,
      plannedTasks: sortTasks(filteredProject.plannedTasks || [], sort),
      archivedTasks: sortTasks(filteredProject.archivedTasks || [], sort),
    };
  }, [filteredProject, sort]);

  const handleMoveAllPlannedToTodo = () => {
    if (!project) return;

    const plannedTasks = project.plannedTasks || [];

    if (plannedTasks.length === 0) {
      toast.info(t("tasks:backlog.noTasksToMove"));
      return;
    }

    if (
      !confirm(
        t("tasks:backlog.moveAllConfirm", { count: plannedTasks.length }),
      )
    ) {
      return;
    }

    for (const task of plannedTasks) {
      updateTask({
        ...task,
        status: "to-do",
      });
    }

    const updatedProject = produce(project, (draft) => {
      // "to-do" is a column slug, so it can only be matched against slug.
      const todoColumn = draft.columns?.find((col) => col.slug === "to-do");
      if (todoColumn && draft.plannedTasks) {
        todoColumn.tasks.push(
          ...draft.plannedTasks.map((task) => ({
            ...task,
            status: "to-do",
          })),
        );

        draft.plannedTasks = [];
      }
    });

    setProject(updatedProject);
    toast.success(
      t("tasks:backlog.moveAllSuccess", { count: plannedTasks.length }),
    );
  };

  return (
    <ProjectLayout
      projectId={projectId}
      workspaceId={workspaceId}
      activeView="backlog"
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
        title={t("tasks:backlog.pageTitle", { name: project?.name })}
      />
      <div className="relative flex flex-col h-full min-h-0 overflow-hidden">
        <div className="border-border/80 border-b bg-card/80 backdrop-blur supports-[backdrop-filter]:bg-card/70">
          <div className="flex min-h-12 items-center px-3 py-2 md:px-4">
            <div className="flex w-full items-center gap-2">
              <div className="flex w-full flex-wrap items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setIsTaskModalOpen(true)}
                  className="h-6 px-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  {t("tasks:backlog.plan")}
                </Button>

                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleMoveAllPlannedToTodo}
                  className="h-6 px-2 text-xs text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  title={t("tasks:backlog.moveAllTooltip")}
                >
                  <ArrowRight className="h-3 w-3 mr-1" />
                  {t("tasks:backlog.moveAll")}
                </Button>

                {filters.priority?.map((priority) => (
                  <Button
                    key={priority}
                    variant="secondary"
                    size="xs"
                    className="h-7 rounded-md px-2 text-xs font-medium gap-1.5"
                  >
                    {getPriorityIcon(priority)}
                    <span>
                      {t("tasks:backlog.filters.priority", {
                        name: getPriorityLabel(priority),
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 p-0 ml-1 hover:bg-destructive-strong hover:text-destructive-strong-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateFilter("priority", priority, false);
                      }}
                    >
                      <X className="h-2.5 w-2.5" />
                    </Button>
                  </Button>
                ))}

                {filters.assignee?.map((assigneeId) => (
                  <Button
                    key={assigneeId}
                    variant="secondary"
                    size="xs"
                    className="h-7 rounded-md px-2 text-xs font-medium gap-1.5"
                  >
                    <User className="h-3 w-3" />
                    <span>
                      {t("tasks:backlog.filters.assignee", {
                        name: getAssigneeDisplayName(assigneeId),
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 p-0 ml-1 hover:bg-destructive-strong hover:text-destructive-strong-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateFilter("assignee", assigneeId, false);
                      }}
                    >
                      <X className="h-2.5 w-2.5" />
                    </Button>
                  </Button>
                ))}

                {filters.dueDate?.map((dueDate) => (
                  <Button
                    key={dueDate}
                    variant="secondary"
                    size="xs"
                    className="h-7 rounded-md px-2 text-xs font-medium gap-1.5"
                  >
                    <Calendar className="h-3 w-3" />
                    <span>
                      {t("tasks:backlog.filters.due", {
                        date: t(
                          dueDate === DUE_DATE_FILTER_VALUES.dueThisWeek
                            ? "tasks:backlog.filters.dueThisWeek"
                            : dueDate === DUE_DATE_FILTER_VALUES.dueNextWeek
                              ? "tasks:backlog.filters.dueNextWeek"
                              : "tasks:backlog.filters.noDueDate",
                          { defaultValue: dueDate },
                        ),
                      })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 p-0 ml-1 hover:bg-destructive-strong hover:text-destructive-strong-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateFilter("dueDate", dueDate, false);
                      }}
                    >
                      <X className="h-2.5 w-2.5" />
                    </Button>
                  </Button>
                ))}

                {filters.labels &&
                  filters.labels.length > 0 &&
                  uniqueLabels
                    .filter((uniqueLabel) =>
                      workspaceLabels
                        .filter(
                          (l: { name: string; color: string }) =>
                            l.name === uniqueLabel.name &&
                            l.color === uniqueLabel.color,
                        )
                        .some((l: { id: string }) =>
                          filters.labels?.includes(l.id),
                        ),
                    )
                    .map((label) => (
                      <Button
                        key={`${label.name}-${label.color}`}
                        variant="secondary"
                        size="xs"
                        className="h-7 rounded-md px-2 text-xs font-medium gap-1.5"
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: resolveLabelColor(label.color),
                          }}
                        />
                        <span>
                          {t("tasks:backlog.filters.label", {
                            name: label.name,
                          })}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-4 w-4 p-0 ml-1 hover:bg-destructive-strong hover:text-destructive-strong-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLabelGroup(label);
                          }}
                        >
                          <X className="h-2.5 w-2.5" />
                        </Button>
                      </Button>
                    ))}

                <SortControl sort={sort} onSortChange={setSort} />

                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-2 px-2.5 text-xs font-medium text-foreground"
                      />
                    }
                  >
                    <Filter className="h-3.5 w-3.5" />
                    {t("tasks:backlog.filter")}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-80" align="start">
                    <DropdownMenuItem
                      disabled
                      className="h-8 rounded-md border border-border/80 bg-card text-sm text-muted-foreground"
                    >
                      {t("tasks:backlog.addFilter")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {hasActiveFilters && (
                      <>
                        <DropdownMenuItem
                          onClick={clearFilters}
                          className="h-8 text-sm text-muted-foreground"
                        >
                          <span>{t("common:actions.clearAllFilters")}</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                      </>
                    )}
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                        {t("tasks:priority.label")}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    {["urgent", "high", "medium", "low"].map((priority) => (
                      <DropdownMenuCheckboxItem
                        key={priority}
                        checked={filters.priority?.includes(priority)}
                        onCheckedChange={(checked) =>
                          updateFilter("priority", priority, checked)
                        }
                        className="h-8 rounded-md text-sm [&_svg]:text-sidebar-foreground"
                      >
                        <div className="flex gap-2 items-center">
                          {getPriorityIcon(priority)}
                          <span className="capitalize">
                            {getPriorityLabel(priority)}
                          </span>
                        </div>
                      </DropdownMenuCheckboxItem>
                    ))}

                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                        {t("tasks:assignee.label")}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    {users?.members?.map((member) => (
                      <DropdownMenuCheckboxItem
                        key={member.userId}
                        checked={filters.assignee?.includes(member.userId)}
                        onCheckedChange={(checked) =>
                          updateFilter("assignee", member.userId, checked)
                        }
                        className="h-8 rounded-md text-sm"
                      >
                        <Avatar className="h-6 w-6 mr-2">
                          <AvatarImage
                            src={member.user?.image ?? ""}
                            alt={member.user?.name || ""}
                          />
                          <AvatarFallback className="text-xs font-medium border border-border/30">
                            {getInitials(member.user?.name)}
                          </AvatarFallback>
                        </Avatar>
                        <span>{member.user?.name}</span>
                      </DropdownMenuCheckboxItem>
                    ))}

                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                        {t("tasks:dueDate.label")}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    {[
                      {
                        label: DUE_DATE_FILTER_VALUES.dueThisWeek,
                        key: "dueThisWeek",
                      },
                      {
                        label: DUE_DATE_FILTER_VALUES.dueNextWeek,
                        key: "dueNextWeek",
                      },
                      {
                        label: DUE_DATE_FILTER_VALUES.noDueDate,
                        key: "noDueDate",
                      },
                    ].map((item) => (
                      <DropdownMenuCheckboxItem
                        key={item.label}
                        checked={filters.dueDate?.includes(item.label)}
                        onCheckedChange={(checked) =>
                          updateFilter("dueDate", item.label, checked)
                        }
                        className="h-8 rounded-md text-sm"
                      >
                        <span>{t(`tasks:backlog.filters.${item.key}`)}</span>
                      </DropdownMenuCheckboxItem>
                    ))}

                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="text-[11px] uppercase tracking-wide">
                        {t("tasks:labels.label")}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                    {uniqueLabels.length > 0 ? (
                      uniqueLabels.map(
                        (label: {
                          id: string;
                          name: string;
                          color: string;
                        }) => (
                          <DropdownMenuCheckboxItem
                            key={label.id}
                            checked={isLabelGroupSelected(label)}
                            onCheckedChange={() => toggleLabelGroup(label)}
                            className="h-8 rounded-md text-sm"
                          >
                            <span
                              className="w-3 h-3 rounded-full flex-shrink-0"
                              style={{
                                backgroundColor: resolveLabelColor(label.color),
                              }}
                            />
                            <span className="max-w-20 truncate">
                              {label.name}
                            </span>
                          </DropdownMenuCheckboxItem>
                        ),
                      )
                    ) : (
                      <DropdownMenuItem
                        disabled
                        className="h-8 rounded-md text-sm text-muted-foreground"
                      >
                        <span>{t("tasks:labels.empty")}</span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-hidden bg-card h-full">
          {sortedProject ? (
            <BacklogListView
              project={sortedProject}
              disableDragDrop={sort.field !== "position"}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 bg-muted rounded-lg animate-pulse mx-auto" />
                <div className="space-y-2">
                  <div className="w-48 h-4 bg-muted rounded animate-pulse mx-auto" />
                  <div className="w-64 h-3 bg-muted rounded animate-pulse mx-auto" />
                </div>
              </div>
            </div>
          )}
        </div>

        <CreateTaskModal
          open={isTaskModalOpen}
          projectId={projectId}
          onClose={() => setIsTaskModalOpen(false)}
          status="planned"
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
