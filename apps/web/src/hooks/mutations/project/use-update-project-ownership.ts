import { useMutation } from "@tanstack/react-query";
import updateProjectOwnership from "@/fetchers/project/update-project-ownership";

function useUpdateProjectOwnership() {
  return useMutation({ mutationFn: updateProjectOwnership });
}

export default useUpdateProjectOwnership;
