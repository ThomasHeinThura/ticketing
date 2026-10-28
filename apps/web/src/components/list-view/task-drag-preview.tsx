import { Flag } from "lucide-react";
import { priorityColorsTaskCard } from "@/constants/priority-colors";
import { cn } from "@/lib/cn";
import type Task from "@/types/task";

/** Original Kaneo ListView drag preview shared by both task data models. */
export default function TaskDragPreview({
  task,
  projectSlug,
}: {
  task: Pick<Task, "priority" | "number" | "title">;
  projectSlug?: string;
}) {
  return (
    <div
      data-testid="list-task-drag-preview"
      className="bg-card border border-border rounded-lg shadow-lg p-2 max-w-[200px] cursor-grabbing"
    >
      <div className="flex items-center gap-2">
        <div className="flex-shrink-0">
          <Flag
            className={cn(
              "w-3 h-3",
              priorityColorsTaskCard[
                task.priority as keyof typeof priorityColorsTaskCard
              ],
            )}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted-foreground">
              {projectSlug}-{task.number}
            </span>
            <span className="text-xs text-foreground truncate">
              {task.title}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
