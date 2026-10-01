import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import updateTask from "@/fetchers/task/update-task";
import { TaskUpdateError } from "@/lib/task-update-error";
import { toast } from "@/lib/toast";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { restoreTaskUpdate, sameFullTaskWrite } from "./restore-task-update";

const taskUpdateMutationKey = ["task-full-update"] as const;
type UpdateContext = {
  shouldRestoreBoard?: boolean;
  expectedCurrent?: Task;
};

type ScheduledRefresh = {
  timer?: ReturnType<typeof setTimeout>;
  recoveries: Map<string, Task>;
};

const scheduledRefreshes = new WeakMap<
  QueryClient,
  Map<string, ScheduledRefresh>
>();

function taskInProject(project: ProjectWithTasks, taskId: string) {
  for (const column of project.columns) {
    const task = column.tasks.find(({ id }) => id === taskId);
    if (task) return task;
  }
  return (
    project.plannedTasks.find(({ id }) => id === taskId) ??
    project.archivedTasks.find(({ id }) => id === taskId)
  );
}

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

function scheduleTaskRefresh(
  queryClient: QueryClient,
  projectId: string,
  recovery?: { taskId: string; expectedCurrent: Task },
) {
  let timers = scheduledRefreshes.get(queryClient);
  if (!timers) {
    timers = new Map();
    scheduledRefreshes.set(queryClient, timers);
  }

  let refresh = timers.get(projectId);
  if (!refresh) {
    refresh = { recoveries: new Map() };
    timers.set(projectId, refresh);
  }
  if (recovery)
    refresh.recoveries.set(recovery.taskId, recovery.expectedCurrent);
  if (refresh.timer) clearTimeout(refresh.timer);

  const scheduledRefresh = refresh;
  scheduledRefresh.timer = setTimeout(() => {
    scheduledRefresh.timer = undefined;
    if (hasPendingTaskUpdate(queryClient, projectId)) return;

    void (async () => {
      const queryKey = ["tasks", projectId];
      await queryClient.invalidateQueries({
        queryKey,
        refetchType: "active",
      });

      if (hasPendingTaskUpdate(queryClient, projectId)) return;
      const latestProject =
        queryClient.getQueryData<ProjectWithTasks>(queryKey);
      const projectStore = useProjectStore.getState();
      const currentProject = projectStore.project;
      if (latestProject && currentProject?.id === projectId) {
        if (scheduledRefresh.recoveries.size === 0) {
          projectStore.setProject(latestProject);
        } else {
          let restoredProject = currentProject;
          for (const [taskId, expectedCurrent] of scheduledRefresh.recoveries) {
            restoredProject = restoreTaskUpdate(
              restoredProject,
              latestProject,
              taskId,
              expectedCurrent,
            );
          }
          projectStore.setProject(restoredProject);
        }
      }
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
    onMutate: (): UpdateContext => ({}),
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
    onError: (error, variables, context) => {
      toast.error(
        error instanceof TaskUpdateError && error.status === 409
          ? t("tasks:update.conflict")
          : t("tasks:update.error"),
      );

      const projectId = variables.projectId;
      const projectStore = useProjectStore.getState();
      const currentProject = projectStore.project;
      const currentTask =
        currentProject?.id === projectId
          ? taskInProject(currentProject, variables.id)
          : undefined;

      if (!sameFullTaskWrite(currentTask, variables)) {
        if (context) context.shouldRestoreBoard = false;
        return;
      }

      if (context) {
        context.shouldRestoreBoard = true;
        context.expectedCurrent = currentTask;
      }

      const cachedProject = queryClient.getQueryData<ProjectWithTasks>([
        "tasks",
        projectId,
      ]);
      if (!cachedProject || !currentProject) return;

      const restored = restoreTaskUpdate(
        currentProject,
        cachedProject,
        variables.id,
        currentTask,
      );
      if (restored !== currentProject) {
        projectStore.setProject(restored);
        if (context) {
          context.expectedCurrent = taskInProject(restored, variables.id);
        }
      }
    },
    onSettled: (_data, _error, variables, context) => {
      scheduleTaskRefresh(
        queryClient,
        variables.projectId,
        context?.shouldRestoreBoard && context.expectedCurrent
          ? { taskId: variables.id, expectedCurrent: context.expectedCurrent }
          : undefined,
      );
    },
  });
}
