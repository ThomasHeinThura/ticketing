import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@taskdesk/ui";
import { Check } from "lucide-react";
import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import { ActionTooltip } from "@/components/common/action-tooltip";
import { cn } from "@/lib/cn";
import { formatDateShort } from "@/lib/format";
import type { PackableTask, WeekSegment } from "./month-grid-model";

export type CalendarTask = PackableTask & {
  title: string;
  number: number | null;
  status: string;
  /** The state category; drives the tint and the spoken state. */
  stateCategory?: "open" | "completed" | "cancelled";
  /** Set only by the change calendar; never inferred from a user-named state. */
  changeKind?: "frozen" | "conflict" | "freeze";
  /** Stored dates and version, so a drag can write them back (`VW-26`). */
  startDate?: string | null;
  dueDate?: string | null;
  version?: number;
};

// Change calendar (P5 `CH-4`, `CH-5`): a window inside a freeze, a same-service conflict, a freeze.
const SPECIAL_CLASSES: Record<string, string> = {
  frozen:
    "border-red-500/45 bg-red-500/15 hover:border-red-500/60 hover:bg-red-500/20",
  conflict:
    "border-amber-500/40 bg-amber-500/15 hover:border-amber-500/55 hover:bg-amber-500/20",
  freeze:
    "border-slate-500/45 bg-slate-500/20 hover:border-slate-500/60 hover:bg-slate-500/25",
};

// States are user-configurable, so colour follows the state category, never its name.
const CANCELLED_CLASS =
  "border-muted-foreground/30 bg-muted/60 hover:border-muted-foreground/45 hover:bg-muted dark:bg-muted/40";
const DONE_CLASS =
  "border-success/35 bg-success/15 hover:border-success/50 hover:bg-success/25 dark:bg-success/20";
const OPEN_CLASS =
  "border-info/35 bg-info/15 hover:border-info/50 hover:bg-info/25 dark:bg-info/20";

export function getCalendarTaskStatusClass(
  task: Pick<CalendarTask, "stateCategory" | "changeKind">,
): string {
  if (task.changeKind) return SPECIAL_CLASSES[task.changeKind];
  if (task.stateCategory === "completed") return DONE_CLASS;
  if (task.stateCategory === "cancelled") return CANCELLED_CLASS;
  return OPEN_CLASS;
}

const STATE_LABEL_KEYS = {
  open: "tasksExtra:calendar.stateOpen",
  completed: "tasksExtra:calendar.stateDone",
  cancelled: "tasksExtra:calendar.stateCancelled",
} as const;

type CalendarTaskBarProps = {
  segment: WeekSegment<CalendarTask>;
  projectSlug?: string;
  onOpenTask: (taskId: string) => void;
  /** Index of the week row this segment is drawn in. */
  weekIndex?: number;
  /** The person may change dates: the bar can be dragged to another day. */
  canReschedule?: boolean;
  /** Selection mode is on: the bar toggles instead of opening (`VW-3`). */
  selectionMode?: boolean;
  isSelected?: boolean;
};

export default function CalendarTaskBar({
  segment,
  projectSlug,
  onOpenTask,
  weekIndex = 0,
  canReschedule = false,
  selectionMode = false,
  isSelected = false,
}: CalendarTaskBarProps): JSX.Element {
  const { t } = useTranslation();
  const {
    task,
    lane,
    columnStart,
    columnEnd,
    continuesBefore,
    continuesAfter,
  } = segment;

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `${task.id}@${weekIndex}`,
      data: { task, startColumn: columnStart - 1, weekIndex },
      disabled: !canReschedule,
    });

  const taskKey =
    projectSlug && task.number != null
      ? `${projectSlug}-${task.number}`
      : undefined;

  const range = `${formatDateShort(task.scheduleStart)} – ${formatDateShort(
    task.scheduleEnd,
  )}`;

  // Colour is never the only cue: the state is also in the tooltip and accessible name.
  const stateLabel =
    task.stateCategory === undefined || task.changeKind
      ? null
      : t(STATE_LABEL_KEYS[task.stateCategory]);
  const withState = (label: string) =>
    stateLabel ? `${label}, ${stateLabel}` : label;

  return (
    <ActionTooltip
      label={withState(
        taskKey
          ? `${taskKey} · ${task.title} · ${range}`
          : `${task.title} · ${range}`,
      )}
    >
      <Button
        variant="ghost"
        type="button"
        ref={setNodeRef}
        {...(canReschedule ? attributes : {})}
        {...(canReschedule ? listeners : {})}
        style={{
          gridColumn: `${columnStart} / ${columnEnd}`,
          // Row 1 holds the date numbers, so lanes start at row 2.
          gridRow: lane + 2,
          transform: CSS.Translate.toString(transform),
        }}
        aria-label={withState(
          selectionMode
            ? t("workItems:bulk.selectItem", { key: taskKey ?? task.title })
            : t("tasksExtra:calendar.taskAriaLabel", {
                title: task.title,
                range,
              }),
        )}
        aria-pressed={selectionMode ? isSelected : undefined}
        data-task-status={task.status}
        onClick={() => onOpenTask(task.id)}
        className={cn(
          isDragging ? "z-30 cursor-grabbing shadow-md" : "z-10",
          "mb-0.5 flex h-6 min-w-0 items-center overflow-hidden border px-1.5 text-left text-[11px] font-medium leading-none text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-5",
          getCalendarTaskStatusClass(task),
          isSelected && "ring-2 ring-ring",
          // Bars stay inset from the cell borders; a side that continues into the next
          // week row is square, a real start or end is rounded.
          "mx-1",
          continuesBefore ? "rounded-l-none" : "rounded-l-md",
          continuesAfter ? "rounded-r-none" : "rounded-r-md",
        )}
      >
        {isSelected ? (
          <Check className="mr-1 size-3 shrink-0" aria-hidden="true" />
        ) : null}
        <span className="truncate">{task.title}</span>
      </Button>
    </ActionTooltip>
  );
}
