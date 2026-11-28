import { useQuery } from "@tanstack/react-query";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";

export const workspacesOptions = () => ({
  queryKey: ["workspaces"],
  queryFn: getWorkspaces,
});

// S3 (issue #6, retrofit plan §3): replaces authClient.useListOrganizations()
// with a plain TanStack query over the native GET /api/workspace route. The
// ["workspaces"] key is deliberate: apps/web/src/routes/_layout/
// _authenticated/dashboard/settings/workspace/general.tsx's delete-workspace
// mutation already invalidates this exact key.
function useGetWorkspaces(refetchOnMount = false, enabled = true) {
  const query = useQuery({
    ...workspacesOptions(),
    refetchOnMount,
    enabled,
  });

  // Getters keep TanStack's tracked properties lazy: a caller that reads only `data` (every
  // list row, through useActiveWorkspace) is not re-rendered when a background fetch starts
  // or ends.
  return {
    get data() {
      return query.data;
    },
    get error() {
      return query.error;
    },
    get isLoading() {
      return query.isPending;
    },
    get isFetching() {
      return query.isFetching;
    },
    get isError() {
      return !!query.error;
    },
    refetch: query.refetch,
  };
}

export default useGetWorkspaces;
