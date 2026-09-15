import { useMutation } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import queryClient from "@/query-client";

type DeleteWorkspaceUserRequest = {
  workspaceId: string;
  userId: string;
};

function useDeleteWorkspaceUser() {
  return useMutation({
    mutationFn: async ({ workspaceId, userId }: DeleteWorkspaceUserRequest) => {
      // Issue #100: native replacement for
      // authClient.organization.removeMember() -- DELETE
      // /api/workspace/{workspaceId}/members/{userId}
      // (apps/api/src/workspace/index.ts's removeWorkspaceMemberRoute). S5
      // shipped this route as a membership write; S3 repointed role-change
      // and ownership-transfer onto their native routes but never this one,
      // even though delete-team-member-modal.tsx calls it live.
      const response = await client.workspace[":workspaceId"].members[
        ":userId"
      ].$delete({
        param: { workspaceId, userId },
      });

      if (!response.ok) {
        // `|| "Failed to remove workspace member"` matches the fallback
        // shape the other native workspace writes use (see
        // update-workspace-member-role.ts): an empty non-2xx body -- a
        // reverse-proxy 502/504 that never reaches Hono's own error
        // handler, which always supplies a message -- must not become a
        // blank `new Error("")` that renders as a blank toast.
        const error = await response.text();
        throw new Error(error || "Failed to remove workspace member");
      }

      return await response.json();
    },
    onSuccess: (_, { workspaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace-invites", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", workspaceId],
      });

      queryClient.invalidateQueries({
        queryKey: ["workspace-users", workspaceId],
      });
    },
  });
}

export default useDeleteWorkspaceUser;
