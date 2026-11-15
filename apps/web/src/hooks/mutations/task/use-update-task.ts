import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import updateTask from "@/fetchers/task/update-task";
import { TaskUpdateError } from "@/lib/task-update-error";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

const taskUpdateMutationKey = ["task-full-update"] as const;

type ScheduledRefresh = {
  timer?: ReturnType<typeof setTimeout>;
};

const scheduledRefreshes = new WeakMap<
  QueryClient,
  Map<string, ScheduledRefresh>
>();

export function hasPendingTaskUpdate(
  queryClient: QueryClient,
  projectId: string,
) {
  return queryClient
    .getMutationCache()
    .getAll()
    .some((mutation) => {
      const variables = mutation.state.variables;
      return (
        mutation.options.mutationKey?.[0] === taskUpdateMutationKey[0] &&
        mutation.state.status === "pending" &&
        typeof variables === "object" &&
        variables !== null &&
        "projectId" in variables &&
        variables.projectId === projectId
      );
    });
}

function scheduleTaskRefresh(queryClient: QueryClient, projectId: string) {
  let timers = scheduledRefreshes.get(queryClient);
  if (!timers) {
    timers = new Map();
    scheduledRefreshes.set(queryClient, timers);
  }

  let refresh = timers.get(projectId);
  if (!refresh) {
    refresh = {};
    timers.set(projectId, refresh);
  }
  if (refresh.timer) clearTimeout(refresh.timer);

  const scheduledRefresh = refresh;
  scheduledRefresh.timer = setTimeout(() => {
    scheduledRefresh.timer = undefined;
    if (hasPendingTaskUpdate(queryClient, projectId)) return;

    void (async () => {
      await queryClient.invalidateQueries({
        queryKey: ["tasks", projectId],
        refetchType: "active",
      });
      if (hasPendingTaskUpdate(queryClient, projectId)) return;
      timers?.delete(projectId);
    })();
  }, 0);
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationKey: taskUpdateMutationKey,
    retry: false,
    mutationFn: (task: Task) => updateTask(task.id, task),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["task", variables.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["notifications"],
      });
      queryClient.invalidateQueries({
        queryKey: ["projects"],
      });
      queryClient.invalidateQueries({
        queryKey: ["activities", variables.id],
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof TaskUpdateError && error.status === 409
          ? t("tasks:update.conflict")
          : t("tasks:update.error"),
      );
    },
    onSettled: (_data, _error, variables) => {
      scheduleTaskRefresh(queryClient, variables.projectId);
    },
  });
}
