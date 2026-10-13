import { useQuery } from "@tanstack/react-query";
import getCustomerOrganisations from "@/fetchers/project/get-customer-organisations";

function useCustomerOrganisations(
  { workspaceId }: { workspaceId: string },
  enabled = true,
) {
  return useQuery({
    queryFn: () => getCustomerOrganisations({ workspaceId }),
    queryKey: ["project-customer-organisations", workspaceId],
    enabled: Boolean(workspaceId) && enabled,
  });
}

export default useCustomerOrganisations;
