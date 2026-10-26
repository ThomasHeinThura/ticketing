import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import type {
  OrganisationProfile,
  OrganisationProjectDefaultOptions,
} from "@/fetchers/god-mode/organisation-lifecycle";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type OrganisationCatalogueItem = {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string | null;
  icon: string | null;
  group: string;
  autoAccept: boolean;
};

export type OrganisationCatalogue = {
  organisationId: string;
  requestTypeIds: string[];
  etag: string;
};

export type CustomerOrganisation = OrganisationProfile & {
  catalogue: OrganisationCatalogue;
  assignedRequestTypes: OrganisationCatalogueItem[];
  deletedAt: string | null;
  purgeAfter: string | null;
  deletionGeneration: number;
  deletionOperationId: string | null;
};

export type OrganisationDirectory = {
  data: CustomerOrganisation[];
  options: OrganisationCatalogueItem[];
  projectDefaultOptions: OrganisationProjectDefaultOptions[];
};

export async function getOrganisations(): Promise<OrganisationDirectory> {
  const response = await apiFetch(getApiUrl("instance/organisations"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Organisation catalogue request failed"),
    );
  return (await response.json()) as OrganisationDirectory;
}

export async function replaceOrganisationCatalogue(input: {
  organisationId: string;
  requestTypeIds: string[];
  expectedCatalogueEtag: string;
}): Promise<{
  catalogue: OrganisationCatalogue;
  assignedRequestTypes: OrganisationCatalogueItem[];
}> {
  const response = await apiFetch(
    getApiUrl(
      `instance/organisations/${encodeURIComponent(input.organisationId)}/catalogue`,
    ),
    {
      method: "PUT",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestTypeIds: input.requestTypeIds,
        expectedCatalogueEtag: input.expectedCatalogueEtag,
      }),
    },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(
        response,
        "Organisation catalogue could not be saved",
      ),
    );
  const body = (await response.json()) as {
    data?: {
      catalogue?: OrganisationCatalogue;
      assignedRequestTypes?: OrganisationCatalogueItem[];
    };
  };
  if (
    body.data?.catalogue?.organisationId !== input.organisationId ||
    typeof body.data.catalogue.etag !== "string" ||
    !Array.isArray(body.data.catalogue.requestTypeIds) ||
    !Array.isArray(body.data.assignedRequestTypes)
  )
    throw new HttpError(502, "Unexpected organisation catalogue response");
  return {
    catalogue: body.data.catalogue,
    assignedRequestTypes: body.data.assignedRequestTypes,
  };
}

export async function requestOrganisationDeletion(organisationId: string) {
  const response = await apiFetch(
    getApiUrl(`instance/organisations/${encodeURIComponent(organisationId)}`),
    {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: "{}",
    },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Deletion request could not be created"),
    );
  const body = (await response.json()) as { pendingActionId?: string };
  if (typeof body.pendingActionId !== "string" || !body.pendingActionId)
    throw new HttpError(502, "Unexpected organisation deletion response");
  return { pendingActionId: body.pendingActionId };
}

export async function requestOrganisationHardPurge(organisationId: string) {
  const response = await apiFetch(getApiUrl("instance/purge"), {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetType: "organisation",
      targetId: organisationId,
    }),
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(
        response,
        "Organisation purge request could not be created",
      ),
    );
  const body = (await response.json()) as {
    pendingActionId?: string;
    action?: string;
    confirmation?: string;
  };
  if (
    typeof body.pendingActionId !== "string" ||
    !body.pendingActionId ||
    body.action !== "purge" ||
    body.confirmation !== "typed_name_step_up"
  )
    throw new HttpError(502, "Unexpected organisation purge response");
  return { pendingActionId: body.pendingActionId };
}

export async function restoreOrganisation(input: {
  organisationId: string;
  expectedOperationId: string;
  expectedGeneration: number;
  stepUpToken: string;
}): Promise<OrganisationProfile> {
  const response = await apiFetch(
    getApiUrl(
      `instance/organisations/${encodeURIComponent(input.organisationId)}/restore`,
    ),
    {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "X-TaskDesk-Step-Up-Token": input.stepUpToken,
      },
      body: JSON.stringify({
        expectedOperationId: input.expectedOperationId,
        expectedGeneration: input.expectedGeneration,
      }),
    },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Organisation could not be restored"),
    );
  const body = (await response.json()) as { data?: unknown };
  if (
    !body.data ||
    typeof body.data !== "object" ||
    !("id" in body.data) ||
    body.data.id !== input.organisationId ||
    !("profileEtag" in body.data) ||
    typeof body.data.profileEtag !== "string"
  )
    throw new HttpError(502, "Unexpected organisation restore response");
  return body.data as OrganisationProfile;
}
