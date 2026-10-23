import {
  DndContext,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
  KeyboardSensor,
  type Modifier,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ScrollArea } from "@taskdesk/ui";
import { format, isSameMonth, isToday, isWeekend } from "date-fns";
import { type JSX, useCallback, useMemo, useRef } from "react";
import { useDndAccessibility } from "@/hooks/use-dnd-accessibility";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/format";
import { resolveCalendarMove } from "./calendar-reschedule";
import CalendarTaskBar, { type CalendarTask } from "./calendar-task-bar";
import DayOverflowPopover from "./day-overflow-popover";
import { DAYS_PER_WEEK, packWeekLanes } from "./month-grid-model";

type MonthGridProps = {
  weeks: Date[][];
  tasks: CalendarTask[];
  visibleMonth: Date;
  /** The accessible name of the grid; defaults to the visible month (`VW-25`). */
  label?: string;
  maxLanes: number;
  projectSlug?: string;
  onOpenTask: (taskId: string) => void;
  /**
   * Called when a bar is dropped on another day (`VW-26`). Absent means the person may not
   * change dates, so bars are not draggable.
   */
  onReschedule?: (task: CalendarTask, dayShift: number) => void;
  /** Selection mode: bars toggle through `onOpenTask` and show their selected state. */
  selectionMode?: boolean;
  selectedIds?: string[];
};

const WEEK_ATTRIBUTE = "data-calendar-week";

type DragData = { task: CalendarTask; startColumn: number; weekIndex: number };

export default function MonthGrid({
  weeks,
  tasks,
  visibleMonth,
  label,
  maxLanes,
  projectSlug,
  onOpenTask,
  onReschedule,
  selectionMode = false,
  selectedIds = [],
}: MonthGridProps): JSX.Element {
  const weeksRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 10 },
    }),
    useSensor(KeyboardSensor, {
      // Space lifts, so Enter still opens the item; arrows move by whole days and weeks.
      keyboardCodes: {
        start: ["Space"],
        cancel: ["Escape"],
        end: ["Space", "Enter"],
      },
      coordinateGetter: calendarKeyboardCoordinates,
    }),
  );

  // Bars are dragged under `${task.id}@${weekIndex}`; announce the task, not that id.
  const describeDnd = useCallback(
    (id: string | number) => {
      const taskId = String(id).split("@")[0];
      return tasks.find((task) => task.id === taskId)?.title;
    },
    [tasks],
  );
  const dndAccessibility = useDndAccessibility(describeDnd);

  const dayCount = weeks[0]?.length ?? DAYS_PER_WEEK;
  const measure = useCallback(() => {
    const rows = Array.from(
      weeksRef.current?.querySelectorAll<HTMLElement>(`[${WEEK_ATTRIBUTE}]`) ??
        [],
    ).map((row) => row.getBoundingClientRect());
    return {
      weekRects: rows.map((rect) => ({ top: rect.top, height: rect.height })),
      cellWidth: (rows[0]?.width ?? 0) / dayCount,
    };
  }, [dayCount]);

  // The bar snaps to whole day cells while it is dragged, using the same arithmetic as the drop.
  const snapToDays: Modifier = useCallback(
    ({ transform, active, activeNodeRect }) => {
      const data = active?.data.current as DragData | undefined;
      if (!data || !activeNodeRect) return transform;
      const { weekRects, cellWidth } = measure();
      if (weekRects.length === 0 || cellWidth <= 0) return transform;
      const move = resolveCalendarMove({
        activeRect: activeNodeRect,
        deltaX: transform.x,
        deltaY: transform.y,
        cellWidth,
        weekRects,
        startColumn: data.startColumn,
      });
      return {
        ...transform,
        x: (move.targetColumn - data.startColumn) * cellWidth,
        y:
          (weekRects[move.targetWeek]?.top ?? 0) -
          (weekRects[move.sourceWeek]?.top ?? 0),
      };
    },
    [measure],
  );

  const handleDragEnd = useCallback(
    ({ active, delta }: DragEndEvent) => {
      const data = active.data.current as DragData | undefined;
      const initial = active.rect.current.initial;
      if (!onReschedule || !data || !initial) return;
      const { weekRects, cellWidth } = measure();
      const { dayShift } = resolveCalendarMove({
        activeRect: initial,
        deltaX: delta.x,
        deltaY: delta.y,
        cellWidth,
        weekRects,
        startColumn: data.startColumn,
      });
      if (dayShift !== 0) onReschedule(data.task, dayShift);
    },
    [measure, onReschedule],
  );

  const weekdayTemplate = weeks[0] ?? [];
  const columnsStyle = {
    gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))`,
  };
  const layouts = useMemo(
    () => weeks.map((week) => packWeekLanes(week, tasks, maxLanes)),
    [weeks, tasks, maxLanes],
  );

  return (
    <DndContext
      accessibility={dndAccessibility}
      sensors={sensors}
      modifiers={[snapToDays]}
      onDragEnd={handleDragEnd}
    >
      <ScrollArea
        className="min-h-0 flex-1"
        role="region"
        aria-label={
          label ??
          formatDate(visibleMonth, {
            month: "long",
            year: "numeric",
          })
        }
      >
        <div className="flex min-h-full flex-col">
          <div
            className="sticky top-0 z-20 grid border-b border-border bg-background/95 backdrop-blur"
            style={columnsStyle}
          >
            {weekdayTemplate.map((day) => (
              <div
                key={`weekday-${day.toISOString()}`}
                className="border-r border-border/60 px-1 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {formatDate(day, { weekday: "short" })}
              </div>
            ))}
          </div>

          <div ref={weeksRef} className="flex min-h-0 flex-1 flex-col">
            {weeks.map((week, weekIndex) => {
              const { segments, hiddenCountByDay, tasksByDay } =
                layouts[weekIndex];

              return (
                <div
                  key={`week-${week[0].toISOString()}`}
                  {...{ [WEEK_ATTRIBUTE]: "" }}
                  className="relative grid min-h-24 flex-1 border-b border-border/70 sm:min-h-28"
                  style={{
                    ...columnsStyle,
                    // Row 1 carries the date numbers, then one row per lane, then a
                    // trailing row for the per-day overflow hint.
                    gridTemplateRows: `auto repeat(${maxLanes}, min-content) auto`,
                  }}
                >
                  {week.map((day, dayIndex) => (
                    <div
                      key={`cell-${day.toISOString()}`}
                      style={{ gridColumn: dayIndex + 1, gridRow: "1 / -1" }}
                      className={cn(
                        "min-w-0 border-r border-border/60",
                        isWeekend(day) && "bg-muted/25",
                      )}
                    />
                  ))}

                  {week.map((day, dayIndex) => (
                    <div
                      key={`number-${day.toISOString()}`}
                      style={{ gridColumn: dayIndex + 1, gridRow: 1 }}
                      className="z-10 flex justify-end px-1 py-1"
                    >
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full text-[11px] font-medium",
                          isToday(day)
                            ? "bg-primary text-primary-foreground"
                            : !isSameMonth(day, visibleMonth)
                              ? "text-muted-foreground"
                              : undefined,
                        )}
                      >
                        {format(day, "d")}
                      </span>
                    </div>
                  ))}

                  {segments.map((segment) => (
                    <CalendarTaskBar
                      key={`bar-${segment.task.id}`}
                      segment={segment}
                      projectSlug={projectSlug}
                      onOpenTask={onOpenTask}
                      weekIndex={weekIndex}
                      canReschedule={Boolean(onReschedule)}
                      selectionMode={selectionMode}
                      isSelected={selectedIds.includes(segment.task.id)}
                    />
                  ))}

                  {week.map((day, dayIndex) =>
                    hiddenCountByDay[dayIndex] > 0 ? (
                      <div
                        key={`overflow-${day.toISOString()}`}
                        style={{
                          gridColumn: dayIndex + 1,
                          gridRow: maxLanes + 2,
                        }}
                        className="z-10 min-w-0"
                      >
                        <DayOverflowPopover
                          day={day}
                          tasks={tasksByDay[dayIndex]}
                          hiddenCount={hiddenCountByDay[dayIndex]}
                          projectSlug={projectSlug}
                          onOpenTask={onOpenTask}
                        />
                      </div>
                    ) : null,
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </DndContext>
  );
}

/** Arrow keys move a lifted bar one day (left, right) or one week (up, down). */
const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (
  event,
  { currentCoordinates },
) => {
  const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    `[${WEEK_ATTRIBUTE}]`,
  );
  if (!row) return undefined;
  const rect = row.getBoundingClientRect();
  const cellWidth = rect.width / DAYS_PER_WEEK;
  switch (event.code) {
    case "ArrowRight":
      return { ...currentCoordinates, x: currentCoordinates.x + cellWidth };
    case "ArrowLeft":
      return { ...currentCoordinates, x: currentCoordinates.x - cellWidth };
    case "ArrowDown":
      return { ...currentCoordinates, y: currentCoordinates.y + rect.height };
    case "ArrowUp":
      return { ...currentCoordinates, y: currentCoordinates.y - rect.height };
    default:
      return undefined;
  }
};
