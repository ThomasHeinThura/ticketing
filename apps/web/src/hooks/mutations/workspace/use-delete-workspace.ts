import { useMutation } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import { refreshWorkspaceStores } from "@/lib/utils/refresh-workspace-stores";

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

      // S4b: keep the plugin's workspace stores in step with the native write.
      refreshWorkspaceStores();

      return await response.json();
    },
  });
}

export default useDeleteWorkspace;
