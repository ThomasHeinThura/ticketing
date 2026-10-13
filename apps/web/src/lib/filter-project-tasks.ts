import { addWeeks, endOfWeek, isWithinInterval, startOfWeek } from "date-fns";
import type { WeekStartDay } from "@/store/user-preferences";
import type Task from "@/types/task";
import {
  type BoardFilters,
  DUE_DATE_FILTER_VALUES,
} from "./project-board-search";

export function filterProjectTasks<T extends Task>(
  tasks: T[],
  options: {
    filters: BoardFilters;
    query?: string;
    projectSlug?: string;
    weekStartsOn: WeekStartDay;
    matchStatusText?: boolean;
  },
): T[] {
  const normalizedQuery = options.query?.trim().toLowerCase();
  const now = new Date();

  return tasks.filter((task) => {
    if (normalizedQuery) {
      const title = task.title?.toLowerCase() ?? "";
      const description = task.description?.toLowerCase() ?? "";
      const taskNumber = task.number?.toString() ?? "";
      const taskIdentifier =
        taskNumber && options.projectSlug
          ? `${options.projectSlug}-${taskNumber}`.toLowerCase()
          : "";
      const taskShortIdentifier = taskNumber ? `#${taskNumber}` : "";
      if (
        !title.includes(normalizedQuery) &&
        !description.includes(normalizedQuery) &&
        !taskNumber.includes(normalizedQuery) &&
        !taskIdentifier.startsWith(normalizedQuery) &&
        !taskShortIdentifier.startsWith(normalizedQuery) &&
        !(
          options.matchStatusText &&
          task.status.toLowerCase().includes(normalizedQuery)
        )
      ) {
        return false;
      }
    }

    if (
      options.filters.status?.length &&
      !options.filters.status.includes(task.status)
    ) {
      return false;
    }
    if (
      options.filters.priority?.length &&
      !options.filters.priority.includes(task.priority ?? "")
    ) {
      return false;
    }
    if (
      options.filters.assignee?.length &&
      !options.filters.assignee.includes(task.userId ?? "")
    ) {
      return false;
    }
    if (options.filters.dueDate?.length) {
      const taskDate = task.dueDate ? new Date(task.dueDate) : null;
      const matchesAnyDueDate = options.filters.dueDate.some((value) => {
        if (value === DUE_DATE_FILTER_VALUES.noDueDate) return !task.dueDate;
        if (!taskDate) return false;
        if (value === DUE_DATE_FILTER_VALUES.dueThisWeek) {
          return isWithinInterval(taskDate, {
            start: startOfWeek(now, { weekStartsOn: options.weekStartsOn }),
            end: endOfWeek(now, { weekStartsOn: options.weekStartsOn }),
          });
        }
        if (value === DUE_DATE_FILTER_VALUES.dueNextWeek) {
          const nextWeek = addWeeks(now, 1);
          return isWithinInterval(taskDate, {
            start: startOfWeek(nextWeek, {
              weekStartsOn: options.weekStartsOn,
            }),
            end: endOfWeek(nextWeek, { weekStartsOn: options.weekStartsOn }),
          });
        }
        return false;
      });
      if (!matchesAnyDueDate) return false;
    }
    if (options.filters.labels?.length) {
      const labelIds = (task.labels ?? []).map((label) => label.id);
      if (
        !options.filters.labels.some((labelId) => labelIds.includes(labelId))
      ) {
        return false;
      }
    }
    return true;
  });
}
