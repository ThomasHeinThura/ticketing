import { useMutation, useQueryClient } from "@tanstack/react-query";
import transferWorkspaceOwnership from "@/fetchers/workspace/transfer-workspace-ownership";

type TransferOwnershipRequest = {
  workspaceId: string;
  newOwnerUserId: string;
};

// S5 (issue #6, retrofit plan §3): repoints this off the former
// promote/demote pair (two sequential
// authClient.organization.updateMemberRole() calls -- see the fetcher's own
// comment for the hazard that created) and onto the atomic native
// transfer-ownership route. The "last owner" rule is no longer implemented
// here at all: the server derives and enforces it inside one transaction.
function useTransferWorkspaceOwnership() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: TransferOwnershipRequest) =>
      transferWorkspaceOwnership(request),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["workspace", "full", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-users", variables.workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-user", "active"],
      });
      queryClient.invalidateQueries({
        queryKey: ["workspace-capabilities", variables.workspaceId],
      });
      queryClient.invalidateQueries({ queryKey: ["active-organization"] });
    },
  });
}

export default useTransferWorkspaceOwnership;
