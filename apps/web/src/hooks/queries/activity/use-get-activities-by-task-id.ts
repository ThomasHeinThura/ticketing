import { useQuery } from "@tanstack/react-query";
import getActivitesByTaskId from "@/fetchers/activity/get-activites-by-task-id";

type Activities = Awaited<ReturnType<typeof getActivitesByTaskId>>;

function useGetActivitiesByTaskId<TSelected = Activities>(
  taskId: string,
  select?: (activities: Activities) => TSelected,
) {
  return useQuery({
    queryKey: ["activities", taskId],
    queryFn: () => getActivitesByTaskId({ taskId }),
    select,
  });
}

export default useGetActivitiesByTaskId;
