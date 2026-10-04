import { useQuery } from "@tanstack/react-query";
import getCustomerOrganisations from "@/fetchers/project/get-customer-organisations";

function useCustomerOrganisations(workspaceId: string) {
  return useQuery({
    queryKey: ["project-customer-organisations", workspaceId],
    queryFn: () => getCustomerOrganisations(workspaceId),
    enabled: Boolean(workspaceId),
  });
}

export default useCustomerOrganisations;
