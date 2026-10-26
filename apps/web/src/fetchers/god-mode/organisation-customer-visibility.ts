import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type CustomerVisibility = "private" | "organisation";

export type OrganisationCustomerVisibility = {
  organisationId: string;
  defaultCustomerVisibility: CustomerVisibility;
  updatedAt: string;
};

const path = (id: string) =>
  `instance/organisations/${encodeURIComponent(id)}/customer-visibility`;

async function request(
  id: string,
  init?: {
    method: "PATCH";
    body: {
      expectedUpdatedAt: string;
      defaultCustomerVisibility: CustomerVisibility;
    };
  },
): Promise<OrganisationCustomerVisibility> {
  const response = await apiFetch(getApiUrl(path(id)), {
    credentials: "include",
    cache: "no-store",
    ...(init
      ? {
          method: init.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }
      : {}),
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Request visibility request failed"),
    );
  const body = (await response.json()) as {
    data?: OrganisationCustomerVisibility;
  };
  if (
    !body.data ||
    body.data.organisationId !== id ||
    (body.data.defaultCustomerVisibility !== "private" &&
      body.data.defaultCustomerVisibility !== "organisation") ||
    typeof body.data.updatedAt !== "string"
  ) {
    throw new HttpError(502, "Unexpected organisation visibility response");
  }
  return body.data;
}

export function getOrganisationCustomerVisibility(
  organisationId: string,
): Promise<OrganisationCustomerVisibility> {
  return request(organisationId);
}

export function patchOrganisationCustomerVisibility(input: {
  organisationId: string;
  expectedUpdatedAt: string;
  defaultCustomerVisibility: CustomerVisibility;
}): Promise<OrganisationCustomerVisibility> {
  return request(input.organisationId, {
    method: "PATCH",
    body: {
      expectedUpdatedAt: input.expectedUpdatedAt,
      defaultCustomerVisibility: input.defaultCustomerVisibility,
    },
  });
}
