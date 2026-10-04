import type { TFunction } from "i18next";
import { memo, useState } from "react";
import type { ProjectWithTasks } from "@/types/project";
import type { TaskCardDisplayPreferences, TaskCardProps } from "../task-card";
import { ColumnDropzone } from "./column-dropzone";
import { ColumnHeader } from "./column-header";

type ColumnProps = {
  column: ProjectWithTasks["columns"][number];
  projectSlug: string;
  projectColumns: ProjectWithTasks["columns"];
  displayPreferences: TaskCardDisplayPreferences;
  selectedTaskIds: Set<string>;
  focusedTaskId: string | null;
  toggleSelection: TaskCardProps["toggleSelection"];
  disableDragDrop?: boolean;
  workspaceId?: string;
  workspaceUsers: TaskCardProps["workspaceUsers"];
  onContextMenuTask: TaskCardProps["onContextMenuTask"];
  onOpenTask: TaskCardProps["onOpenTask"];
  t: TFunction;
};

function Column({
  column,
  projectSlug,
  projectColumns,
  displayPreferences,
  selectedTaskIds,
  focusedTaskId,
  toggleSelection,
  disableDragDrop = false,
  workspaceId,
  workspaceUsers,
  onContextMenuTask,
  onOpenTask,
  t,
}: ColumnProps) {
  const [isDropzoneOver, setIsDropzoneOver] = useState(false);

  return (
    <div
      data-column-id={column.id}
      className={`group relative flex h-full min-h-0 w-full flex-col rounded-xl border transition-colors duration-150 ${
        isDropzoneOver
          ? "border-ring/40 bg-accent/60 shadow-md ring-2 ring-ring/30"
          : "border-border/70 bg-muted/40 shadow-xs/5 hover:border-border/90 dark:bg-card/90"
      }`}
    >
      <div className="shrink-0 border-b border-border/60 px-3 py-2">
        <ColumnHeader column={column} t={t} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 [-webkit-overflow-scrolling:touch]">
        <ColumnDropzone
          column={column}
          projectSlug={projectSlug}
          projectColumns={projectColumns}
          displayPreferences={displayPreferences}
          selectedTaskIds={selectedTaskIds}
          focusedTaskId={focusedTaskId}
          toggleSelection={toggleSelection}
          disableDragDrop={disableDragDrop}
          onIsOverChange={setIsDropzoneOver}
          workspaceId={workspaceId}
          workspaceUsers={workspaceUsers}
          onContextMenuTask={onContextMenuTask}
          onOpenTask={onOpenTask}
          t={t}
        />
      </div>
    </div>
  );
}

export default memo(Column);
