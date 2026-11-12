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
function useGetWorkspaces(refetchOnMount = false) {
  const {
    data: workspaces,
    error,
    isPending,
    isFetching,
    refetch,
  } = useQuery({
    ...workspacesOptions(),
    refetchOnMount,
  });

  return {
    data: workspaces,
    error,
    isLoading: isPending,
    isFetching,
    isError: !!error,
    refetch,
  };
}

export default useGetWorkspaces;
