import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  type DropAnimation,
  defaultAnnouncements,
  defaultDropAnimationSideEffects,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ContextMenu, ContextMenuTrigger } from "@taskdesk/ui";
import { produce } from "immer";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import CreateTaskModal from "@/components/shared/modals/create-task-modal";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import type { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { isTaskCompleted } from "@/lib/due-date-status";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";
import BulkToolbar from "../bulk-selection/bulk-toolbar";
import Column from "./column";
import type {
  TaskCardDisplayPreferences,
  TaskCardWorkspaceUser,
} from "./task-card";
import TaskCard, { TaskCardDeleteConfirmation } from "./task-card";
import TaskCardContextMenuContent from "./task-card-context-menu/task-card-context-menu-content";

const boardAnnouncements = {
  ...defaultAnnouncements,
  onDragOver({
    active,
    over,
  }: Parameters<typeof defaultAnnouncements.onDragOver>[0]) {
    if (over?.id === active.id) {
      return defaultAnnouncements.onDragStart({ active });
    }
    return defaultAnnouncements.onDragOver({ active, over });
  },
};

type KanbanBoardProps = {
  project: ProjectWithTasks;
  workspaceId: string;
  workspaceUsers: ReturnType<typeof useGetActiveWorkspaceUsers>["data"];
  disableDragDrop?: boolean;
};

function KanbanBoard({
  project,
  workspaceId,
  workspaceUsers,
  disableDragDrop = false,
}: KanbanBoardProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const setProject = useProjectStore((state) => state.setProject);
  const displayPreferences = useUserPreferencesStore(
    useShallow((state) => ({
      showAssignees: state.showAssignees,
      showPriority: state.showPriority,
      showDueDates: state.showDueDates,
      showLabels: state.showLabels,
      showTaskNumbers: state.showTaskNumbers,
      showTaskItemCounts: state.showTaskItemCounts,
    })),
  ) as TaskCardDisplayPreferences;
  const {
    setAvailableTasks,
    focusNext,
    focusPrevious,
    focusedTaskId,
    selectedTaskIds,
    toggleSelection,
    clearFocus,
  } = useBulkSelectionStore(
    useShallow((state) => ({
      setAvailableTasks: state.setAvailableTasks,
      focusNext: state.focusNext,
      focusPrevious: state.focusPrevious,
      focusedTaskId: state.focusedTaskId,
      selectedTaskIds: state.selectedTaskIds,
      toggleSelection: state.toggleSelection,
      clearFocus: state.clearFocus,
    })),
  );
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [contextMenuTaskId, setContextMenuTaskId] = useState<string | null>(
    null,
  );
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [createTaskStatus, setCreateTaskStatus] = useState<string | null>(null);
  const createTaskTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workspaceUsersById = useMemo(() => {
    const members = workspaceUsers?.members ?? [];
    return new Map<string, TaskCardWorkspaceUser>(
      members.map((member) => [member.userId, member]),
    );
  }, [workspaceUsers?.members]);
  const columnCompletionBySlug = useMemo(
    () =>
      new Map(project.columns.map((column) => [column.slug, column.isFinal])),
    [project.columns],
  );
  const { mutate: updateTask } = useUpdateTask();
  const navigate = useNavigate();
  const handleOpenTask = useCallback(
    (taskId: string) => {
      const currentTaskId = new URLSearchParams(window.location.search).get(
        "taskId",
      );
      navigate({
        to: ".",
        search: currentTaskId === taskId ? {} : { taskId },
      });
    },
    [navigate],
  );
  const handleCreateTask = useCallback(
    (status: string, trigger: HTMLButtonElement) => {
      createTaskTriggerRef.current = trigger;
      setCreateTaskStatus(status);
    },
    [],
  );
  const handleCloseCreateTask = useCallback(() => {
    setCreateTaskStatus(null);
    window.requestAnimationFrame(() => {
      if (createTaskTriggerRef.current?.isConnected) {
        createTaskTriggerRef.current.focus();
      }
    });
  }, []);
  const allTasks = useMemo(
    () => project.columns?.flatMap((column) => column.tasks) ?? [],
    [project.columns],
  );
  const contextMenuTask = contextMenuTaskId
    ? allTasks.find((task) => task.id === contextMenuTaskId)
    : undefined;

  const setContextTaskFromEvent = (event: React.SyntheticEvent) => {
    const target = event.target;
    const element = target instanceof Element ? target : null;
    const taskCard = element?.closest<HTMLElement>("[data-task-id]");
    if (
      !taskCard ||
      !allTasks.some((task) => task.id === taskCard.dataset.taskId)
    ) {
      event.stopPropagation();
      return;
    }
    setContextMenuTaskId(taskCard.dataset.taskId ?? null);
  };

  const openContextMenuForTask = useCallback((taskId: string) => {
    setContextMenuTaskId(taskId);
    setIsContextMenuOpen(true);
  }, []);

  useEffect(() => {
    if (project?.columns) {
      const allTaskIds = project.columns.flatMap((column) =>
        column.tasks.map((task) => task.id),
      );
      setAvailableTasks(allTaskIds);
    }
  }, [project, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  useRegisterShortcuts({
    shortcuts: {
      j: () => {
        focusNext();
        const state = useBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({ to: ".", search: { taskId: state.focusedTaskId } });
        }
      },
      k: () => {
        focusPrevious();
        const state = useBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({ to: ".", search: { taskId: state.focusedTaskId } });
        }
      },
      Enter: () => {
        if (focusedTaskId && project) {
          navigate({
            to: "/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId",
            params: {
              workspaceId: project.workspaceId,
              projectId: project.id,
              taskId: focusedTaskId,
            },
          });
        }
      },
    },
  });

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: disableDragDrop ? 999999 : 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: disableDragDrop ? 999999 : 250,
        tolerance: 10,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const dropAnimation: DropAnimation = {
    sideEffects: defaultDropAnimationSideEffects({
      styles: {
        active: {
          opacity: "0.8",
        },
      },
    }),
    duration: 300,
    easing: "cubic-bezier(0.23, 1, 0.32, 1)",
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over || !project?.columns) return;

    const activeId = active.id.toString();
    const overId = over.id.toString();

    const updatedProject = produce(project, (draft) => {
      const sourceColumn = draft?.columns?.find((col) =>
        col.tasks.some((task) => task.id === activeId),
      );
      const destinationColumn = draft?.columns?.find(
        (col) =>
          col.id === overId || col.tasks.some((task) => task.id === overId),
      );

      if (!sourceColumn || !destinationColumn) return;

      const sourceTaskIndex = sourceColumn.tasks.findIndex(
        (task) => task.id === activeId,
      );
      const task = sourceColumn.tasks[sourceTaskIndex];

      sourceColumn.tasks = sourceColumn.tasks.filter((t) => t.id !== activeId);

      if (sourceColumn.id === destinationColumn.id) {
        let destinationIndex = destinationColumn.tasks.findIndex(
          (t) => t.id === overId,
        );
        if (sourceTaskIndex <= destinationIndex) {
          destinationIndex += 1;
        }
        destinationColumn.tasks.splice(destinationIndex, 0, task);

        destinationColumn.tasks.forEach((t, index) => {
          updateTask({ ...t, position: index });
        });

        queryClient.invalidateQueries({
          queryKey: ["projects", project.workspaceId],
        });
      } else {
        // A task's status is a column slug. The column id is only the
        // droppable identity here, and the two are interchangeable only
        // because the tasks endpoint happens to return `id: column.slug`.
        task.status = destinationColumn.slug;
        const destinationIndex =
          overId === destinationColumn.id
            ? destinationColumn.tasks.length
            : destinationColumn.tasks.findIndex((t) => t.id === overId) + 1;

        destinationColumn.tasks.splice(destinationIndex, 0, task);

        destinationColumn.tasks.forEach((t, index) => {
          updateTask({ ...t, status: destinationColumn.slug, position: index });
        });

        sourceColumn.tasks.forEach((t, index) => {
          updateTask({ ...t, position: index });
        });
      }
    });

    setProject(updatedProject);
    setActiveId(null);
  };

  if (!project?.columns) {
    return (
      <div className="flex h-full w-full flex-col bg-background">
        <header className="mb-6 mt-6 space-y-6 shrink-0 px-6">
          <div className="flex items-center justify-between">
            <div className="w-48 h-8 bg-muted/50 rounded-md animate-pulse" />
          </div>
        </header>

        <div className="relative min-h-0 flex-1">
          <div className="flex h-full flex-1 gap-4 overflow-x-auto px-4 pb-4 md:px-5">
            {[...Array(4)].map((_, i) => (
              <div
                key={`kanban-column-skeleton-${
                  // biome-ignore lint/suspicious/noArrayIndexKey: It's a skeleton
                  i
                }`}
                className="h-full min-w-80 w-full flex-1 rounded-xl border border-border/70 bg-card"
              >
                <div className="px-4 py-3 flex items-center justify-between">
                  <div className="w-24 h-5 bg-muted/50 rounded animate-pulse" />
                  <div className="w-8 h-5 bg-muted/50 rounded animate-pulse" />
                </div>

                <div className="px-2 pb-4 flex flex-col gap-3 flex-1">
                  {[...Array(3)].map((_, j) => (
                    <div
                      key={`kanban-task-skeleton-${
                        // biome-ignore lint/suspicious/noArrayIndexKey: It's a skeleton
                        j
                      }`}
                      className="p-4 bg-card rounded-lg border border-border/50 animate-pulse"
                    >
                      <div className="space-y-3">
                        <div className="w-2/3 h-4 bg-muted/70 rounded" />
                        <div className="w-1/2 h-3 bg-muted/70 rounded" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const activeTask = activeId
    ? project.columns
        .flatMap((col) => col.tasks)
        .find((task) => task.id === activeId)
    : null;

  return (
    <DndContext
      accessibility={{ announcements: boardAnnouncements }}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <ContextMenu
        open={isContextMenuOpen}
        onOpenChange={(open) => {
          setIsContextMenuOpen(open);
          if (!open) setContextMenuTaskId(null);
        }}
      >
        <ContextMenuTrigger asChild>
          <div
            className="flex h-full w-full flex-col bg-background"
            onContextMenuCapture={setContextTaskFromEvent}
          >
            <div className="min-h-0 flex-1 overflow-x-auto [-webkit-overflow-scrolling:touch]">
              <div className="flex h-full min-w-max gap-4 px-4 py-4 md:px-5">
                {project.columns?.map((column) => (
                  <div
                    key={column.id}
                    className="h-full max-w-96 min-w-80 shrink-0 flex-1"
                  >
                    <Column
                      column={column}
                      projectSlug={project.slug}
                      projectColumns={project.columns}
                      columnCompletionBySlug={columnCompletionBySlug}
                      displayPreferences={displayPreferences}
                      selectedTaskIds={selectedTaskIds}
                      focusedTaskId={focusedTaskId}
                      toggleSelection={toggleSelection}
                      disableDragDrop={disableDragDrop}
                      workspaceId={workspaceId}
                      workspaceUsersById={workspaceUsersById}
                      onContextMenuTask={openContextMenuForTask}
                      onOpenTask={handleOpenTask}
                      onCreateTask={handleCreateTask}
                      t={t}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        {contextMenuTask ? (
          <TaskCardContextMenuContent
            task={contextMenuTask}
            taskCardContext={{
              projectId: project.id,
              worskpaceId: workspaceId,
            }}
            onDeleteClick={() => {
              setDeleteTaskId(contextMenuTask.id);
              setIsContextMenuOpen(false);
            }}
          />
        ) : null}
      </ContextMenu>
      <DragOverlay dropAnimation={dropAnimation}>
        {activeTask ? (
          <div className="transform rotate-1 scale-[1.03] shadow-lg">
            <div className="ring-2 ring-ring/35 rounded-lg">
              <TaskCard
                task={activeTask}
                projectSlug={project.slug}
                taskIsCompleted={isTaskCompleted(
                  activeTask.status,
                  project.columns,
                )}
                displayPreferences={displayPreferences}
                isTaskSelected={selectedTaskIds.has(activeTask.id)}
                isTaskFocused={focusedTaskId === activeTask.id}
                toggleSelection={toggleSelection}
                workspaceId={workspaceId}
                assignee={
                  activeTask.userId
                    ? workspaceUsersById.get(activeTask.userId)
                    : undefined
                }
                onContextMenuTask={openContextMenuForTask}
                onOpenTask={handleOpenTask}
                t={t}
              />
            </div>
          </div>
        ) : null}
      </DragOverlay>

      <BulkToolbar />
      <CreateTaskModal
        open={createTaskStatus !== null}
        onClose={handleCloseCreateTask}
        projectId={project.id}
        status={createTaskStatus ?? undefined}
      />
      {deleteTaskId ? (
        <TaskCardDeleteConfirmation
          taskId={deleteTaskId}
          onOpenChange={(open) => {
            if (!open) setDeleteTaskId(null);
          }}
        />
      ) : null}
    </DndContext>
  );
}

export default memo(KanbanBoard);
