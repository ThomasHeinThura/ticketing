import { useMutation, useQueryClient } from "@tanstack/react-query";
import restoreProject from "@/fetchers/project/restore-project";

function useRestoreProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreProject,
    onSuccess: async (project) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["projects"] }),
        queryClient.invalidateQueries({ queryKey: ["project", project.id] }),
      ]);
    },
  });
}

export default useRestoreProject;
