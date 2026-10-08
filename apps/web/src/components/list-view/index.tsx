import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  type UniqueIdentifier,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useNavigate } from "@tanstack/react-router";
import { ContextMenu, ContextMenuTrigger } from "@taskdesk/ui";
import { AnimatePresence, motion } from "framer-motion";
import type { TFunction } from "i18next";
import { produce } from "immer";
import { Archive, ChevronRight, Flag, Plus } from "lucide-react";
import type { ReactNode } from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { priorityColorsTaskCard } from "@/constants/priority-colors";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";
import { useGetActiveWorkspaceUsers } from "@/hooks/queries/workspace-users/use-get-active-workspace-users";
import { useRegisterShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import {
  type ProjectBoardSearch,
  withProjectBoardTask,
} from "@/lib/project-board-search";
import { toast } from "@/lib/toast";
import useBulkSelectionStore from "@/store/bulk-selection";
import useProjectStore from "@/store/project";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { ProjectWithTasks } from "@/types/project";
import BulkToolbar from "../bulk-selection/bulk-toolbar";
import type { TaskCardWorkspaceUser } from "../kanban-board/task-card";
import TaskCardContextMenuContent from "../kanban-board/task-card-context-menu/task-card-context-menu-content";
import { ArchiveTasksModal } from "../shared/modals/archive-tasks-modal";
import CreateTaskModal from "../shared/modals/create-task-modal";
import TaskRow from "./task-row";

const TaskCardDeleteConfirmation = lazy(
  () => import("../kanban-board/task-card-delete-confirmation"),
);

type ListViewProps = {
  project: ProjectWithTasks;
  disableDragDrop?: boolean;
};

type ListColumnSectionProps = {
  column: ProjectWithTasks["columns"][number];
  expanded: boolean;
  showDropIndicator: boolean;
  onToggle: () => void;
  onAddTask: () => void;
  onArchive: () => void;
  t: TFunction;
  children: ReactNode;
};

function ListColumnSection({
  column,
  expanded,
  showDropIndicator,
  onToggle,
  onAddTask,
  onArchive,
  t,
  children,
}: ListColumnSectionProps) {
  const { setNodeRef } = useDroppable({
    id: column.id,
    data: { type: "column", column },
  });

  return (
    <div
      className={cn(
        "border-b border-border/50 transition-colors duration-150 overflow-auto",
        showDropIndicator && "border-l-4 border-l-ring bg-accent/35",
      )}
    >
      <div className="flex items-center justify-between py-2 px-4 bg-muted/60 border-b border-border/50">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight
            className={cn(
              "w-3 h-3 transition-transform",
              expanded && "rotate-90",
            )}
          />
          <div className="flex items-center gap-2 h-4">
            {getColumnIcon(column.id, column.isFinal, column.icon)}
            <div className="flex items-center gap-1">
              <span className="mt-1 mr-1">{column.name}</span>
              <span className="text-xs text-muted-foreground mt-0.5">
                {column.tasks.length}
              </span>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onAddTask}
            className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
            title={t("tasks:listView.addTask")}
          >
            <Plus className="w-3 h-3" />
          </button>
          {column.isFinal && column.tasks.length > 0 && (
            <button
              type="button"
              onClick={onArchive}
              className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              title={t("tasks:listView.archiveAllTooltip")}
            >
              <Archive className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div
          ref={setNodeRef}
          className="bg-card transition-[translate,opacity] duration-150 ease-out starting:-translate-y-1 starting:opacity-0 motion-reduce:starting:translate-y-0"
        >
          <SortableContext
            items={column.tasks}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence initial={false} mode="popLayout">
              {children}
            </AnimatePresence>
          </SortableContext>
          {column.tasks.length === 0 && (
            <div className="py-6 px-4 text-center text-xs text-muted-foreground">
              {t("tasks:listView.noTasks")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ListView({ project, disableDragDrop = false }: ListViewProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setProject = useProjectStore((state) => state.setProject);
  const { data: workspace } = useActiveWorkspace();
  const { data: workspaceUsers } = useGetActiveWorkspaceUsers(
    workspace?.id ?? "",
  );
  const displayPreferences = useUserPreferencesStore(
    useShallow((state) => ({
      showAssignees: state.showAssignees,
      showPriority: state.showPriority,
      showDueDates: state.showDueDates,
      showLabels: state.showLabels,
      showTaskNumbers: state.showTaskNumbers,
    })),
  );
  const workspaceUsersById = useMemo(
    () =>
      new Map<string, TaskCardWorkspaceUser>(
        (workspaceUsers?.members ?? []).map((member) => [
          member.userId,
          member,
        ]),
      ),
    [workspaceUsers?.members],
  );
  const taskById = useMemo(() => {
    const byId = new Map<
      string,
      ProjectWithTasks["columns"][number]["tasks"][number]
    >();
    for (const column of project.columns) {
      for (const task of column.tasks) byId.set(task.id, task);
    }
    return byId;
  }, [project.columns]);
  const columnByTaskId = useMemo(() => {
    const byTaskId = new Map<string, ProjectWithTasks["columns"][number]>();
    for (const column of project.columns) {
      for (const task of column.tasks) byTaskId.set(task.id, column);
    }
    return byTaskId;
  }, [project.columns]);
  const completionByStatus = useMemo(
    () =>
      new Map(project.columns.map((column) => [column.slug, column.isFinal])),
    [project.columns],
  );
  const [contextMenuTaskId, setContextMenuTaskId] = useState<string | null>(
    null,
  );
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const contextMenuTask = contextMenuTaskId
    ? taskById.get(contextMenuTaskId)
    : undefined;
  const handleOpenTask = useCallback(
    (taskId: string) => {
      navigate({
        to: ".",
        search: (previous: ProjectBoardSearch) =>
          withProjectBoardTask(previous, taskId || undefined),
      });
    },
    [navigate],
  );
  const setContextTaskFromEvent = (event: React.MouseEvent) => {
    const target = event.target;
    const element = target instanceof Element ? target : null;
    const taskRow = element?.closest<HTMLElement>("[data-task-id]");
    if (!taskRow || !taskById.has(taskRow.dataset.taskId ?? "")) {
      event.stopPropagation();
      return;
    }
    setContextMenuTaskId(taskRow.dataset.taskId ?? null);
  };
  const { setAvailableTasks, focusNext, focusPrevious, clearFocus } =
    useBulkSelectionStore(
      useShallow((state) => ({
        setAvailableTasks: state.setAvailableTasks,
        focusNext: state.focusNext,
        focusPrevious: state.focusPrevious,
        clearFocus: state.clearFocus,
      })),
    );
  const { mutate: updateTask } = useUpdateTask();
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >(() => {
    const sections: Record<string, boolean> = {};
    if (project?.columns) {
      for (const col of project.columns) {
        sections[col.id] = true;
      }
    }
    return sections;
  });
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [activeColumn, setActiveColumn] = useState<string | null>(null);
  const [isArchiveModalOpen, setIsArchiveModalOpen] = useState(false);
  const [columnToArchive, setColumnToArchive] = useState<
    ProjectWithTasks["columns"][number] | null
  >(null);

  useEffect(() => {
    if (project?.columns) {
      const visibleTaskIds = project.columns
        .filter((column) => expandedSections[column.id])
        .flatMap((column) => column.tasks.map((task) => task.id));
      setAvailableTasks(visibleTaskIds);
    }
  }, [project, expandedSections, setAvailableTasks]);

  useEffect(() => {
    clearFocus();
  }, [clearFocus]);

  useRegisterShortcuts({
    shortcuts: {
      j: () => {
        focusNext();
        const state = useBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({
            to: ".",
            search: (previous: ProjectBoardSearch) =>
              withProjectBoardTask(previous, state.focusedTaskId ?? undefined),
          });
        }
      },
      k: () => {
        focusPrevious();
        const state = useBulkSelectionStore.getState();
        if (state.focusedTaskId) {
          navigate({
            to: ".",
            search: (previous: ProjectBoardSearch) =>
              withProjectBoardTask(previous, state.focusedTaskId ?? undefined),
          });
        }
      },
      Enter: () => {
        const focusedTaskId = useBulkSelectionStore.getState().focusedTaskId;
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
        delay: disableDragDrop ? 999999 : 200,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event;
    if (!over || !activeId) {
      setOverColumnId(null);
      return;
    }

    if (project?.columns?.some((col) => col.id === over.id)) {
      setOverColumnId(over.id.toString());
      return;
    }

    const taskId = over.id.toString();
    const columnWithTask = columnByTaskId.get(taskId);

    if (columnWithTask) {
      setOverColumnId(columnWithTask.id);
    } else {
      setOverColumnId(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverColumnId(null);

    if (!over || !project?.columns) return;

    const activeTaskId = active.id.toString();
    const overId = over.id.toString();

    const updatedProject = produce(project, (draft) => {
      const sourceColumn = draft?.columns?.find((col) =>
        col.tasks.some((task) => task.id === activeTaskId),
      );
      const destinationColumn = draft?.columns?.find(
        (col) =>
          col.id === overId || col.tasks.some((task) => task.id === overId),
      );

      if (!sourceColumn || !destinationColumn) return;

      const sourceTaskIndex = sourceColumn.tasks.findIndex(
        (task) => task.id === activeTaskId,
      );
      const task = sourceColumn.tasks[sourceTaskIndex];

      sourceColumn.tasks = sourceColumn.tasks.filter(
        (t) => t.id !== activeTaskId,
      );

      if (sourceColumn.id === destinationColumn.id) {
        let destinationIndex = destinationColumn.tasks.findIndex(
          (t) => t.id === overId,
        );
        if (sourceTaskIndex <= destinationIndex) {
          destinationIndex += 1;
        }
        destinationColumn.tasks.splice(destinationIndex, 0, task);

        destinationColumn.tasks.forEach((t, index) => {
          updateTask({
            ...t,
            status: destinationColumn.slug,
            position: index,
          });
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
          updateTask({
            ...t,
            status: destinationColumn.slug,
            position: index,
          });
        });

        sourceColumn.tasks.forEach((t, index) => {
          updateTask({
            ...t,
            position: index,
          });
        });
      }
    });

    setProject(updatedProject);
  };

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));
  }, []);

  const handleAddTask = useCallback((columnId: string) => {
    setIsTaskModalOpen(true);
    setActiveColumn(columnId);
  }, []);

  const handleArchiveClick = useCallback(
    (column: ProjectWithTasks["columns"][number]) => {
      if (!column.isFinal || column.tasks.length === 0) return;
      setColumnToArchive(column);
      setIsArchiveModalOpen(true);
    },
    [],
  );

  const handleConfirmArchive = () => {
    if (!columnToArchive) return;

    const updatedProject = produce(project, (draft) => {
      const archivedColumn = draft?.columns?.find(
        (col) => col.id === columnToArchive.id,
      );
      if (!archivedColumn) return;

      for (const task of archivedColumn.tasks) {
        updateTask({
          ...task,
          status: "archived",
        });
      }

      archivedColumn.tasks = [];
    });

    setProject(updatedProject);
    toast.success(
      t("tasks:archive.success", { count: columnToArchive.tasks.length }),
    );

    setIsArchiveModalOpen(false);
    setColumnToArchive(null);
  };

  if (!project?.columns) {
    return null;
  }

  const activeTask = activeId ? taskById.get(activeId.toString()) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      modifiers={[snapCenterToCursor]}
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
            className="w-full h-full overflow-auto bg-muted/20"
            onContextMenuCapture={setContextTaskFromEvent}
          >
            <div className="divide-y divide-border/50">
              {project.columns.map((column) => (
                <ListColumnSection
                  key={column.id}
                  column={column}
                  expanded={Boolean(expandedSections[column.id])}
                  showDropIndicator={Boolean(
                    activeId && overColumnId === column.id,
                  )}
                  onToggle={() => toggleSection(column.id)}
                  onAddTask={() => handleAddTask(column.id)}
                  onArchive={() => handleArchiveClick(column)}
                  t={t}
                >
                  {column.tasks.map((task) => (
                    <motion.div
                      key={task.id}
                      initial={false}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                    >
                      <TaskRow
                        task={task}
                        projectSlug={project.slug}
                        taskIsCompleted={
                          completionByStatus.size > 0
                            ? (completionByStatus.get(task.status) ?? false)
                            : task.status === "done" ||
                              task.status === "archived"
                        }
                        assignee={
                          task.userId
                            ? workspaceUsersById.get(task.userId)
                            : undefined
                        }
                        displayPreferences={displayPreferences}
                        onOpenTask={handleOpenTask}
                        t={t}
                      />
                    </motion.div>
                  ))}
                </ListColumnSection>
              ))}
            </div>
          </div>
        </ContextMenuTrigger>
        {contextMenuTask && workspace?.id ? (
          <TaskCardContextMenuContent
            task={contextMenuTask}
            taskCardContext={{
              projectId: project.id,
              worskpaceId: workspace.id,
            }}
            onDeleteClick={() => {
              setDeleteTaskId(contextMenuTask.id);
              setIsContextMenuOpen(false);
            }}
          />
        ) : null}
      </ContextMenu>

      <DragOverlay>
        {activeTask && (
          <div className="bg-card border border-border rounded-lg shadow-lg p-2 max-w-[200px] cursor-grabbing">
            <div className="flex items-center gap-2">
              <div className="flex-shrink-0">
                <Flag
                  className={cn(
                    "w-3 h-3",
                    priorityColorsTaskCard[
                      activeTask.priority as keyof typeof priorityColorsTaskCard
                    ],
                  )}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {project?.slug}-{activeTask.number}
                  </span>
                  <span className="text-xs text-foreground truncate">
                    {activeTask.title}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </DragOverlay>

      <CreateTaskModal
        open={isTaskModalOpen}
        projectId={project.id}
        onClose={() => setIsTaskModalOpen(false)}
        status={activeColumn ?? "done"}
      />
      <ArchiveTasksModal
        open={isArchiveModalOpen}
        onClose={() => {
          setIsArchiveModalOpen(false);
          setColumnToArchive(null);
        }}
        onConfirm={handleConfirmArchive}
        taskCount={columnToArchive?.tasks.length ?? 0}
      />

      <BulkToolbar />
      {deleteTaskId ? (
        <Suspense
          fallback={
            <div role="status" aria-live="polite">
              {t("common:empty.loading")}
            </div>
          }
        >
          <TaskCardDeleteConfirmation
            taskId={deleteTaskId}
            onOpenChange={(open) => {
              if (!open) setDeleteTaskId(null);
            }}
          />
        </Suspense>
      ) : null}
    </DndContext>
  );
}

export default ListView;
