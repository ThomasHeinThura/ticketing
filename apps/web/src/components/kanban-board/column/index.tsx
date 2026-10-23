import type { TFunction } from "i18next";
import { memo, useState } from "react";
import type { ProjectWithTasks } from "@/types/project";
import type {
  TaskCardDisplayPreferences,
  TaskCardProps,
  TaskCardWorkspaceUser,
} from "../task-card";
import { ColumnDropzone } from "./column-dropzone";
import { ColumnHeader } from "./column-header";
import { ColumnShell } from "./column-shell";

type ColumnProps = {
  column: ProjectWithTasks["columns"][number];
  projectSlug: string;
  projectColumns: ProjectWithTasks["columns"];
  columnCompletionBySlug: ReadonlyMap<string, boolean>;
  displayPreferences: TaskCardDisplayPreferences;
  selectedTaskIds: ReadonlySet<string>;
  focusedTaskId: string | null;
  disableDragDrop?: boolean;
  workspaceId?: string;
  workspaceUsersById: ReadonlyMap<string, TaskCardWorkspaceUser>;
  onContextMenuTask: TaskCardProps["onContextMenuTask"];
  onOpenTask: TaskCardProps["onOpenTask"];
  onCreateTask: (status: string, trigger: HTMLButtonElement) => void;
  t: TFunction;
};

function Column({
  column,
  projectSlug,
  projectColumns,
  columnCompletionBySlug,
  displayPreferences,
  selectedTaskIds,
  focusedTaskId,
  disableDragDrop = false,
  workspaceId,
  workspaceUsersById,
  onContextMenuTask,
  onOpenTask,
  onCreateTask,
  t,
}: ColumnProps) {
  const [isDropzoneOver, setIsDropzoneOver] = useState(false);

  return (
    <ColumnShell
      data-column-id={column.id}
      isOver={isDropzoneOver}
      header={
        <ColumnHeader column={column} onCreateTask={onCreateTask} t={t} />
      }
    >
      <ColumnDropzone
        column={column}
        projectSlug={projectSlug}
        projectColumns={projectColumns}
        columnCompletionBySlug={columnCompletionBySlug}
        displayPreferences={displayPreferences}
        selectedTaskIds={selectedTaskIds}
        focusedTaskId={focusedTaskId}
        disableDragDrop={disableDragDrop}
        onIsOverChange={setIsDropzoneOver}
        workspaceId={workspaceId}
        workspaceUsersById={workspaceUsersById}
        onContextMenuTask={onContextMenuTask}
        onOpenTask={onOpenTask}
        t={t}
      />
    </ColumnShell>
  );
}

export default memo(Column);
