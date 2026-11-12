import { useQuery, useQueryClient } from "@tanstack/react-query";
import useAuth from "@/components/providers/auth-provider/hooks/use-auth";
import getActiveWorkspaceUsers from "@/fetchers/workspace-user/get-active-workspace-users";
import useActiveWorkspace from "@/hooks/queries/workspace/use-active-workspace";

/** The caller's own membership row in the active workspace. */
export type ActiveWorkspaceUser = {
  id: string;
  personId: string | null;
  role: string;
  name: string;
  email: string;
  image: string | null | undefined;
};

/**
 * How old a members list read by another screen part may be and still answer this hook's first
 * read. The work item detail mounts this hook (through `useWorkspacePermission`) next to the
 * activity and audit history, which read the same `GET /api/workspace/{id}/members` under
 * `["active-workspace-users", id]`; reusing that read, or joining it while in flight, stops the
 * screen asking for the same list twice.
 */
const SHARED_MEMBERS_READ_FRESH_MS = 5_000;

// S3 (issue #6, retrofit plan §3, matrix row 13): native replacement for
// authClient.organization.listMembers(), filtered client-side to the
// caller's own row -- there is still no dedicated "my membership" route, so
// this keeps doing the same whole-list-then-filter the plugin-backed
// version did, just against GET /api/workspace/{workspaceId}/members.
//
// The key stays ["workspace-user", "active", ...], so the role-change and ownership-transfer
// mutations that invalidate it keep working. A read they ask for (an invalidated entry) always
// goes to the server and refreshes the shared list too; only a first read reuses a fresh or
// in-flight list read.
export const useGetActiveWorkspaceUser = ({
  enabled = true,
}: {
  /** `false` reads nothing; for a caller that only sometimes needs the membership. */
  enabled?: boolean;
} = {}) => {
  const { user } = useAuth();
  const { data: workspace } = useActiveWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = workspace?.id;
  const userId = user?.id;
  const queryKey = ["workspace-user", "active", workspaceId, userId] as const;

  return useQuery({
    queryKey,
    enabled: enabled && !!workspaceId && !!userId,
    queryFn: async (): Promise<ActiveWorkspaceUser | null> => {
      const listKey = ["active-workspace-users", workspaceId] as const;
      const read = () =>
        getActiveWorkspaceUsers({ workspaceId: workspaceId as string });
      const refreshAsked =
        queryClient.getQueryState(queryKey)?.isInvalidated === true;
      let list: Awaited<ReturnType<typeof getActiveWorkspaceUsers>>;
      if (refreshAsked) {
        list = await read();
        queryClient.setQueryData(listKey, list);
      } else {
        list = await queryClient.fetchQuery({
          queryKey: listKey,
          queryFn: read,
          staleTime: SHARED_MEMBERS_READ_FRESH_MS,
          // This hook's own query owns the retry policy; retrying here too would stack them.
          retry: false,
        });
      }
      const member = list.members.find((row) => row.userId === userId);
      if (!member) return null;
      return {
        id: member.userId,
        personId: member.personId,
        role: member.role,
        name: member.user.name,
        email: member.user.email,
        image: member.user.image,
      };
    },
  });
};
