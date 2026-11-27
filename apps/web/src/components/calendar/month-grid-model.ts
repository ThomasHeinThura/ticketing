import {
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export const DAYS_PER_WEEK = 7;

export type WeekStartsOn = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Any task already normalized by `toScheduledTasks`. Kept minimal so the layout
 * math stays independent of the task payload.
 */
export type PackableTask = {
  id: string;
  scheduleStart: Date;
  scheduleEnd: Date;
};

export type WeekSegment<TTask extends PackableTask> = {
  task: TTask;
  lane: number;
  /** 1-based CSS grid line where the bar starts. */
  columnStart: number;
  /** Exclusive CSS grid line where the bar ends. */
  columnEnd: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

export type WeekLayout<TTask extends PackableTask> = {
  segments: Array<WeekSegment<TTask>>;
  /** Per weekday index, how many tasks did not fit within `maxLanes`. */
  hiddenCountByDay: number[];
  /**
   * Per weekday index, every task overlapping that day — visible or not — in
   * the same order the lanes were packed. Backs the overflow popover.
   */
  tasksByDay: TTask[][];
};

/**
 * Week-aligned month grid: always whole weeks, so the first and last row can
 * carry days from the neighbouring months.
 */
export function buildMonthWeeks(
  visibleMonth: Date,
  weekStartsOn: WeekStartsOn,
): Date[][] {
  const gridStart = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn });
  const gridEnd = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weeks: Date[][] = [];
  for (let index = 0; index < days.length; index += DAYS_PER_WEEK) {
    weeks.push(days.slice(index, index + DAYS_PER_WEEK));
  }

  return weeks;
}

/**
 * Packs every task of the visible grid into lanes once, so a multi-week bar keeps
 * the same lane in every week row. Tasks are placed in global order (start day,
 * longer first, then id) at the first lane that is free on every day they span.
 * Tasks past `maxLanes` stay hidden for their whole span and are counted per day
 * so each cell can render an overflow hint.
 */
export function packMonthLanes<TTask extends PackableTask>(
  weeks: Date[][],
  tasks: TTask[],
  maxLanes: number,
): Array<WeekLayout<TTask>> {
  const gridStart = weeks[0]?.[0];
  const dayCount = weeks[0]?.length || DAYS_PER_WEEK;
  const lastGridDay = weeks.length * dayCount - 1;

  const placed = (gridStart ? tasks : [])
    .map((task) => {
      const start = differenceInCalendarDays(
        task.scheduleStart,
        gridStart as Date,
      );
      const end = differenceInCalendarDays(task.scheduleEnd, gridStart as Date);
      return { task, start, end };
    })
    .filter(({ start, end }) => end >= 0 && start <= lastGridDay)
    .sort(
      (left, right) =>
        Math.max(left.start, 0) - Math.max(right.start, 0) ||
        left.start - right.start ||
        right.end - right.start - (left.end - left.start) ||
        left.task.id.localeCompare(right.task.id),
    );

  // lanes[lane][gridDay] is true when a bar already covers that day.
  const lanes: boolean[][] = [];
  const layouts = weeks.map(
    (): WeekLayout<TTask> => ({
      segments: [],
      hiddenCountByDay: new Array<number>(dayCount).fill(0),
      tasksByDay: Array.from({ length: dayCount }, () => []),
    }),
  );

  for (const { task, start, end } of placed) {
    const from = Math.max(0, start);
    const to = Math.min(lastGridDay, end);

    let lane = lanes.findIndex((busy) => {
      for (let day = from; day <= to; day += 1) if (busy[day]) return false;
      return true;
    });
    if (lane === -1) {
      lane = lanes.length;
      lanes.push([]);
    }
    for (let day = from; day <= to; day += 1) lanes[lane][day] = true;

    for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
      const weekFirst = weekIndex * dayCount;
      const clippedStart = Math.max(from, weekFirst);
      const clippedEnd = Math.min(to, weekFirst + dayCount - 1);
      if (clippedStart > clippedEnd) continue;

      const layout = layouts[weekIndex];
      for (let day = clippedStart; day <= clippedEnd; day += 1) {
        layout.tasksByDay[day - weekFirst].push(task);
        if (lane >= maxLanes) layout.hiddenCountByDay[day - weekFirst] += 1;
      }
      if (lane < maxLanes) {
        layout.segments.push({
          task,
          lane,
          columnStart: clippedStart - weekFirst + 1,
          columnEnd: clippedEnd - weekFirst + 2,
          continuesBefore: start < weekFirst,
          continuesAfter: end > weekFirst + dayCount - 1,
        });
      }
    }
  }

  return layouts;
}

/** The tasks that overlap at least one day of the grid, i.e. the ones a person can see. */
export function tasksInWeeks<TTask extends PackableTask>(
  weeks: Date[][],
  tasks: TTask[],
): TTask[] {
  const first = weeks[0]?.[0];
  const last = weeks.at(-1)?.at(-1);
  if (!first || !last) return [];
  return tasks.filter(
    (task) =>
      differenceInCalendarDays(task.scheduleEnd, first) >= 0 &&
      differenceInCalendarDays(task.scheduleStart, last) <= 0,
  );
}
