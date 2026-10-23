import { useMutation } from "@tanstack/react-query";
import deleteWorkspace from "@/fetchers/workspace/delete-workspace";

type DeleteWorkspaceRequest = {
  workspaceId: string;
};

/** Requests workspace deletion (`202` pending action); nothing is removed until approval. */
function useDeleteWorkspace() {
  return useMutation({
    mutationFn: ({ workspaceId }: DeleteWorkspaceRequest) =>
      deleteWorkspace({ id: workspaceId }),
  });
}

export default useDeleteWorkspace;
