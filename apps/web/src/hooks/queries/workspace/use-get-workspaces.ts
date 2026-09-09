import { useQuery } from "@tanstack/react-query";
import getWorkspaces from "@/fetchers/workspace/get-workspaces";

// S3 (issue #6, retrofit plan §3): replaces authClient.useListOrganizations()
// with a plain TanStack query over the native GET /api/workspace route. The
// ["workspaces"] key is deliberate: apps/web/src/routes/_layout/
// _authenticated/dashboard/settings/workspace/general.tsx's delete-workspace
// mutation already invalidates this exact key.
function useGetWorkspaces() {
  const {
    data: workspaces,
    error,
    isPending,
  } = useQuery({
    queryKey: ["workspaces"],
    queryFn: getWorkspaces,
  });

  return {
    data: workspaces,
    error,
    isLoading: isPending,
    isError: !!error,
  };
}

export default useGetWorkspaces;
