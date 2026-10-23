import { useMutation } from "@tanstack/react-query";
import updateProjectState from "@/fetchers/project/update-project-state";

function useUpdateProjectState() {
  return useMutation({ mutationFn: updateProjectState });
}

export default useUpdateProjectState;
