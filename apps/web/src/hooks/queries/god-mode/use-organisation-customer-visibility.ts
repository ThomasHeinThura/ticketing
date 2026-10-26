import { useQuery } from "@tanstack/react-query";
import { getOrganisationCustomerVisibility } from "@/fetchers/god-mode/organisation-customer-visibility";
import { HttpError } from "@/lib/http-error";

export const organisationCustomerVisibilityKey = (organisationId: string) =>
  ["god-mode", "organisation-customer-visibility", organisationId] as const;

const retryTransient = (count: number, error: unknown) =>
  !(error instanceof HttpError && error.status < 500) && count < 1;

export function useOrganisationCustomerVisibility(
  organisationId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: organisationCustomerVisibilityKey(organisationId),
    queryFn: () => getOrganisationCustomerVisibility(organisationId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    retry: retryTransient,
  });
}
