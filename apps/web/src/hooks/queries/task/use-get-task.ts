import { useQuery } from "@tanstack/react-query";
import getTask from "@/fetchers/task/get-task";

function useGetTask(taskId: string) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: ({ signal }) => getTask(taskId, signal),
    enabled: Boolean(taskId),
    refetchOnMount: "always",
    staleTime: 0,
  });
}

export default useGetTask;
