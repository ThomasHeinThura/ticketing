import { useQuery } from "@tanstack/react-query";
import { client } from "@taskdesk/libs";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

// S3 (issue #6, retrofit plan §3, matrix row 13): native replacement for
// authClient.organization.listMembers(), filtered client-side to the
// caller's own row -- there is still no dedicated "my membership" route, so
// this keeps doing the same whole-list-then-filter the plugin-backed
// version did, just against GET /api/workspace/{workspaceId}/members. The
// native member's `id` IS the user's id (see the WorkspaceUser type), so the
// filter is `member.id === user.id` rather than the plugin shape's
// `member.userId === user.id`.
export const useGetActiveWorkspaceUser = () => {
  const { user } = useAuth();
  const { data: workspace } = useActiveWorkspace();

  return useQuery({
    queryKey: ["workspace-user", "active", workspace?.id, user?.id],
    enabled: !!workspace?.id && !!user?.id,
    queryFn: async () => {
      const response = await client.workspace[":workspaceId"].members.$get({
        param: { workspaceId: workspace?.id as string },
      });

      if (!response.ok) {
        throw new Error("Failed to get active workspace user");
      }

      const members = await response.json();
      return members.find((member) => member.id === user?.id) ?? null;
    },
  });
};
