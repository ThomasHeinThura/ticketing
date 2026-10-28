import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { Button } from "@taskdesk/ui";
import { AnimatePresence } from "framer-motion";
import type { TFunction } from "i18next";
import { Archive, ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { getColumnIcon } from "@/lib/column";
import type { ProjectWithTasks } from "@/types/project";

type ListColumnSectionProps = {
  column: ProjectWithTasks["columns"][number];
  expanded: boolean;
  showDropIndicator: boolean;
  onToggle: () => void;
  /** Receives the "+" button, so a dialog it opens can return focus to it. */
  onAddTask?: (trigger: HTMLButtonElement) => void;
  onArchive?: () => void;
  t: TFunction;
  children: ReactNode;
};

export function ListColumnSection({
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
        <Button
          variant="ghost"
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
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
        </Button>

        <div className="flex items-center gap-1">
          {onAddTask && (
            <Button
              variant="ghost"
              type="button"
              onClick={(event) => onAddTask(event.currentTarget)}
              className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              title={t("tasks:listView.addTask")}
            >
              <Plus className="w-3 h-3" />
            </Button>
          )}
          {onArchive && column.isFinal && column.tasks.length > 0 && (
            <Button
              variant="ghost"
              type="button"
              onClick={onArchive}
              className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              title={t("tasks:listView.archiveAllTooltip")}
            >
              <Archive className="w-3 h-3" />
            </Button>
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
