import { addDays, format } from "date-fns";
import { dayToIso, isoToDay } from "@/lib/work-item-date";
import { DAYS_PER_WEEK } from "./month-grid-model";

/** A rectangle reduced to the numbers the calendar's drag arithmetic needs. */
export type CalendarRect = { top: number; height: number };

export type CalendarMoveInput = {
  /** The dragged bar's rectangle when the drag started. */
  activeRect: CalendarRect;
  deltaX: number;
  deltaY: number;
  /** Width of one day column. */
  cellWidth: number;
  /** One rectangle per week row, in grid order. */
  weekRects: CalendarRect[];
  /** 0-based weekday column where the dragged segment starts. */
  startColumn: number;
};

export type CalendarMove = {
  sourceWeek: number;
  targetWeek: number;
  targetColumn: number;
  /** Whole days the item moves; positive is later. */
  dayShift: number;
};

const center = (rect: CalendarRect) => rect.top + rect.height / 2;

function nearestWeek(weekRects: CalendarRect[], y: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  weekRects.forEach((rect, index) => {
    const distance =
      y >= rect.top && y <= rect.top + rect.height
        ? 0
        : Math.min(
            Math.abs(y - rect.top),
            Math.abs(y - rect.top - rect.height),
          );
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/**
 * Maps a drag of a calendar bar onto whole days. The same function drives the snapping
 * modifier and the drop, so the bar always lands where it was drawn. Mouse, touch and keyboard
 * all go through it because it only reads the drag's translation, never the pointer.
 */
export function resolveCalendarMove({
  activeRect,
  deltaX,
  deltaY,
  cellWidth,
  weekRects,
  startColumn,
}: CalendarMoveInput): CalendarMove {
  if (weekRects.length === 0 || cellWidth <= 0) {
    return {
      sourceWeek: 0,
      targetWeek: 0,
      targetColumn: startColumn,
      dayShift: 0,
    };
  }
  const sourceWeek = nearestWeek(weekRects, center(activeRect));
  const targetWeek = nearestWeek(weekRects, center(activeRect) + deltaY);
  const targetColumn = Math.max(
    0,
    Math.min(DAYS_PER_WEEK - 1, startColumn + Math.round(deltaX / cellWidth)),
  );
  return {
    sourceWeek,
    targetWeek,
    targetColumn,
    dayShift:
      (targetWeek - sourceWeek) * DAYS_PER_WEEK + (targetColumn - startColumn),
  };
}

/**
 * Moves a stored date by whole calendar days. This is the write the detail pane makes when a
 * person picks the day `days` away (`dayToIso` over `isoToDay`): the day moves, the stored
 * UTC time of day stays, and no daylight-saving arithmetic can shift the stored date. A plain
 * date stays a plain date.
 */
export function shiftStoredDate(value: string, days: number): string {
  const day = isoToDay(value);
  if (!day || Number.isNaN(day.getTime())) return value;
  const shifted = addDays(day, days);
  return value.length <= 10
    ? format(shifted, "yyyy-MM-dd")
    : (dayToIso(shifted, value) ?? value);
}

/**
 * The fields a calendar move writes. Only a date the item has is moved, so an item with a
 * due date alone keeps no start date, and a spanning item keeps its length.
 */
export function rescheduledFields(
  task: { startDate?: string | null; dueDate?: string | null },
  dayShift: number,
): { startDate?: string; dueDate?: string } {
  const fields: { startDate?: string; dueDate?: string } = {};
  if (task.startDate)
    fields.startDate = shiftStoredDate(task.startDate, dayShift);
  if (task.dueDate) fields.dueDate = shiftStoredDate(task.dueDate, dayShift);
  return fields;
}
