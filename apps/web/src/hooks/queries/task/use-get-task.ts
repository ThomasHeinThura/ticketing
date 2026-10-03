import { useQuery } from "@tanstack/react-query";
import getTask from "@/fetchers/task/get-task";

type TaskData = Awaited<ReturnType<typeof getTask>>;

function useGetTask<TSelected = TaskData>(
  taskId: string,
  select?: (task: TaskData) => TSelected,
) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: ({ signal }) => getTask(taskId, signal),
    enabled: Boolean(taskId),
    refetchOnMount: "always",
    staleTime: 0,
    select,
  });
}

export default useGetTask;
