import { useMutation, useQueryClient } from "@tanstack/react-query";
import { rescheduledFields } from "@/components/calendar/calendar-reschedule";
import updateWorkItem from "@/fetchers/work-item/update-work-item";
import {
  currentWorkItemVersion,
  writeWorkItemResponse,
} from "./work-item-save";

export type ReschedulableTask = {
  id: string;
  version?: number;
  startDate?: string | null;
  dueDate?: string | null;
};

type ScheduleTasks = {
  columns?: Array<{ tasks: ReschedulableTask[] }>;
  plannedTasks?: ReschedulableTask[];
};

function patchSchedule(
  data: ScheduleTasks | undefined,
  key: string,
  fields: { startDate?: string; dueDate?: string },
) {
  if (!data) return data;
  const patch = (task: ReschedulableTask) =>
    task.id === key ? { ...task, ...fields } : task;
  return {
    ...data,
    columns: data.columns?.map((column) => ({
      ...column,
      tasks: column.tasks.map(patch),
    })),
    plannedTasks: data.plannedTasks?.map(patch),
  };
}

/**
 * `VW-26`: moving an item on the calendar is the canonical `PATCH /api/work-items/{key}`
 * with the item's current version (`If-Match`), the same write the Gantt bar and the detail
 * pane make. The bar moves at once and snaps back if the server refuses the change. Writes to
 * one item share a mutation scope, so a second drop waits for the first and asserts the
 * version the first returned.
 */
export function useRescheduleWorkItem(projectId: string) {
  const queryClient = useQueryClient();
  const scheduleKey = ["work-items", projectId, "schedule"] as const;

  return useMutation({
    mutationFn: async ({
      task,
      dayShift,
    }: {
      task: ReschedulableTask;
      dayShift: number;
    }) => {
      const fields = rescheduledFields(task, dayShift);
      const updated = await updateWorkItem({
        key: task.id,
        version: currentWorkItemVersion(queryClient, {
          key: task.id,
          version: task.version ?? 0,
        }),
        ...fields,
      });
      writeWorkItemResponse(queryClient, task.id, updated, {
        startDate: updated.startDate,
        dueDate: updated.dueDate,
      });
    },
    // One calendar's drops run one after another, so each asserts the version the last returned.
    scope: { id: `work-item-calendar:${projectId}` },
    onMutate: async ({ task, dayShift }) => {
      await queryClient.cancelQueries({ queryKey: scheduleKey });
      const snapshots = queryClient.getQueriesData<ScheduleTasks>({
        queryKey: scheduleKey,
      });
      const fields = rescheduledFields(task, dayShift);
      queryClient.setQueriesData<ScheduleTasks>(
        { queryKey: scheduleKey },
        (data) => patchSchedule(data, task.id, fields),
      );
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.snapshots ?? [])
        queryClient.setQueryData(key, data);
    },
    onSettled: async (_data, _error, { task }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["work-items", projectId] }),
        queryClient.invalidateQueries({
          queryKey: ["work-items", "detail", task.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ["work-items", "activity", task.id],
        }),
      ]);
    },
  });
}
