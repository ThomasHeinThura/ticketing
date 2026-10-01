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
  type TaskCompletionColumn,
} from "../task-card";

type ColumnDropzoneProps = {
  column: ProjectWithTasks["columns"][number];
  disableDragDrop?: boolean;
  onIsOverChange?: (isOver: boolean) => void;
  workspaceId?: string;
  workspaceUsers: TaskCardProps["workspaceUsers"];
  onContextMenuTask: TaskCardProps["onContextMenuTask"];
  projectSlug: string;
  completionColumns: TaskCompletionColumn[];
  displayPreferences: TaskCardDisplayPreferences;
};

export function ColumnDropzone({
  column,
  disableDragDrop = false,
  onIsOverChange,
  workspaceId,
  workspaceUsers,
  onContextMenuTask,
  projectSlug,
  completionColumns,
  displayPreferences,
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
              disableDragDrop={disableDragDrop}
              workspaceId={workspaceId}
              workspaceUsers={workspaceUsers}
              onContextMenuTask={onContextMenuTask}
              projectSlug={projectSlug}
              taskIsCompleted={isTaskCompleted(task.status, completionColumns)}
              displayPreferences={displayPreferences}
            />
          ))}
        </div>
      </SortableContext>
    </div>
  );
}
