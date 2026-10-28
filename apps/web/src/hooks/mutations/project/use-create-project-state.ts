import { useMutation } from "@tanstack/react-query";
import createProjectState from "@/fetchers/project/create-project-state";

function useCreateProjectState() {
  return useMutation({ mutationFn: createProjectState });
}

export default useCreateProjectState;
