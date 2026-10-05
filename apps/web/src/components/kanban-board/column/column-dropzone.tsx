import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { memo, useEffect } from "react";
import type { ProjectWithTasks } from "@/types/project";
import TaskCard, {
  type TaskCardDisplayPreferences,
  type TaskCardProps,
  type TaskCardWorkspaceUser,
} from "../task-card";

type ColumnDropzoneProps = {
  column: ProjectWithTasks["columns"][number];
  projectSlug: string;
  projectColumns: ProjectWithTasks["columns"];
  columnCompletionBySlug: ReadonlyMap<string, boolean>;
  displayPreferences: TaskCardDisplayPreferences;
  disableDragDrop?: boolean;
  onIsOverChange?: (isOver: boolean) => void;
  workspaceId?: string;
  workspaceUsersById: ReadonlyMap<string, TaskCardWorkspaceUser>;
  onContextMenuTask: TaskCardProps["onContextMenuTask"];
  onOpenTask: TaskCardProps["onOpenTask"];
  t: TaskCardProps["t"];
};

export function ColumnDropzone({
  column,
  projectSlug,
  projectColumns,
  columnCompletionBySlug,
  displayPreferences,
  disableDragDrop = false,
  onIsOverChange,
  workspaceId,
  workspaceUsersById,
  onContextMenuTask,
  onOpenTask,
  t,
}: ColumnDropzoneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: {
      type: "column",
      column,
    },
  });

  useEffect(() => {
    onIsOverChange?.(isOver);
  }, [isOver, onIsOverChange]);

  return (
    <div ref={setNodeRef} className="flex-1 min-h-0">
      <SortableContext
        items={column.tasks}
        strategy={verticalListSortingStrategy}
      >
        <TaskCardList
          column={column}
          projectSlug={projectSlug}
          projectColumns={projectColumns}
          columnCompletionBySlug={columnCompletionBySlug}
          displayPreferences={displayPreferences}
          disableDragDrop={disableDragDrop}
          workspaceId={workspaceId}
          workspaceUsersById={workspaceUsersById}
          onContextMenuTask={onContextMenuTask}
          onOpenTask={onOpenTask}
          t={t}
        />
      </SortableContext>
    </div>
  );
}

const TaskCardList = memo(function TaskCardList({
  column,
  projectSlug,
  projectColumns,
  columnCompletionBySlug,
  displayPreferences,
  disableDragDrop = false,
  workspaceId,
  workspaceUsersById,
  onContextMenuTask,
  onOpenTask,
  t,
}: ColumnDropzoneProps) {
  return (
    <div className="flex flex-col gap-2 [contain:layout_style]">
      {column.tasks.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          projectSlug={projectSlug}
          taskIsCompleted={
            projectColumns.length > 0
              ? (columnCompletionBySlug.get(task.status) ?? false)
              : task.status === "done" || task.status === "archived"
          }
          displayPreferences={displayPreferences}
          disableDragDrop={disableDragDrop}
          workspaceId={workspaceId}
          assignee={
            task.userId ? workspaceUsersById.get(task.userId) : undefined
          }
          onContextMenuTask={onContextMenuTask}
          onOpenTask={onOpenTask}
          t={t}
        />
      ))}
    </div>
  );
});
