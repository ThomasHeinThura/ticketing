import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useEffect } from "react";
import { isTaskCompleted } from "@/lib/due-date-status";
import type { ProjectWithTasks } from "@/types/project";
import TaskCard, {
  type TaskCardDisplayPreferences,
  type TaskCardProps,
} from "../task-card";

type ColumnDropzoneProps = {
  column: ProjectWithTasks["columns"][number];
  projectSlug: string;
  projectColumns: ProjectWithTasks["columns"];
  displayPreferences: TaskCardDisplayPreferences;
  selectedTaskIds: Set<string>;
  focusedTaskId: string | null;
  toggleSelection: TaskCardProps["toggleSelection"];
  disableDragDrop?: boolean;
  onIsOverChange?: (isOver: boolean) => void;
  workspaceId?: string;
  workspaceUsers: TaskCardProps["workspaceUsers"];
  onContextMenuTask: TaskCardProps["onContextMenuTask"];
};

export function ColumnDropzone({
  column,
  projectSlug,
  projectColumns,
  displayPreferences,
  selectedTaskIds,
  focusedTaskId,
  toggleSelection,
  disableDragDrop = false,
  onIsOverChange,
  workspaceId,
  workspaceUsers,
  onContextMenuTask,
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
        <div className="flex flex-col gap-2">
          {column.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              projectSlug={projectSlug}
              taskIsCompleted={isTaskCompleted(task.status, projectColumns)}
              displayPreferences={displayPreferences}
              isTaskSelected={selectedTaskIds.has(task.id)}
              isTaskFocused={focusedTaskId === task.id}
              toggleSelection={toggleSelection}
              disableDragDrop={disableDragDrop}
              workspaceId={workspaceId}
              workspaceUsers={workspaceUsers}
              onContextMenuTask={onContextMenuTask}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
