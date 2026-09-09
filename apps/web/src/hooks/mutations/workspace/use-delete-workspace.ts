import { useMutation } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";

type DeleteWorkspaceRequest = {
  workspaceId: string;
};

function useDeleteWorkspace() {
  return useMutation({
    mutationFn: async ({ workspaceId }: DeleteWorkspaceRequest) => {
      // S4b: native replacement for authClient.organization.delete().
      const response = await client.workspace[":workspaceId"].$delete({
        param: { workspaceId },
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }

      return await response.json();
    },
  });
}

export default useDeleteWorkspace;
