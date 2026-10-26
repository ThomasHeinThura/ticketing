import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type OrganisationQuota = {
  maxProjects: number;
  maxWorkItems: number;
  maxStorageBytes: number;
  maxPortalUsers: number;
  maxApiRequestsPerMinute: number;
  maxWebhooks: number;
};

export type OrganisationProjectDefault = {
  workspaceId: string;
  serviceCalendarId: string | null;
  slaPolicyId: string | null;
};

export type OrganisationProfileValues = {
  name: string;
  key: string;
  emailDomains: string[];
  portalAccess: boolean;
  defaultCustomerVisibility: "private" | "organisation";
  quota: OrganisationQuota;
  projectDefaults: OrganisationProjectDefault[];
};

export type OrganisationProfile = OrganisationProfileValues & {
  id: string;
  active: boolean;
  profileEtag: string;
};

export type ProjectDefaultOption = {
  id: string;
  name: string;
  published?: boolean;
};

export type OrganisationProjectDefaultOptions = {
  workspaceId: string;
  workspaceName: string;
  serviceCalendars: ProjectDefaultOption[];
  slaPolicies: ProjectDefaultOption[];
};

export type CreateOrganisationInput = OrganisationProfileValues & {
  requestTypeIds: string[];
  initialContact?: { email: string; workspaceId: string };
};

export type InitialInvitationReceipt = {
  id: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
};

const organisationUrl = (id: string) =>
  getApiUrl(`instance/organisations/${encodeURIComponent(id)}`);

async function readOrganisation(
  response: Response,
): Promise<OrganisationProfile> {
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Organisation could not be saved"),
    );
  const body = (await response.json()) as { data?: OrganisationProfile };
  if (
    !body.data ||
    typeof body.data.id !== "string" ||
    typeof body.data.profileEtag !== "string" ||
    !Array.isArray(body.data.emailDomains) ||
    !Array.isArray(body.data.projectDefaults)
  )
    throw new HttpError(502, "Unexpected organisation profile response");
  return body.data;
}

export async function createOrganisation(
  input: CreateOrganisationInput,
): Promise<{
  profile: OrganisationProfile;
  initialInvitation: InitialInvitationReceipt | null;
}> {
  const response = await apiFetch(getApiUrl("instance/organisations"), {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Organisation could not be created"),
    );
  const body = (await response.json()) as {
    data?: OrganisationProfile & {
      initialInvitation?: InitialInvitationReceipt | null;
    };
  };
  if (
    !body.data ||
    typeof body.data.id !== "string" ||
    typeof body.data.profileEtag !== "string" ||
    !Array.isArray(body.data.emailDomains) ||
    !Array.isArray(body.data.projectDefaults) ||
    !(
      body.data.initialInvitation === null ||
      (body.data.initialInvitation &&
        typeof body.data.initialInvitation.id === "string" &&
        typeof body.data.initialInvitation.status === "string" &&
        typeof body.data.initialInvitation.expiresAt === "string")
    )
  )
    throw new HttpError(502, "Unexpected organisation create response");
  const { initialInvitation, ...profile } = body.data;
  return { profile, initialInvitation: initialInvitation ?? null };
}

export async function updateOrganisationProfile(input: {
  organisationId: string;
  expectedProfileEtag: string;
  values: OrganisationProfileValues;
}): Promise<OrganisationProfile> {
  return readOrganisation(
    await apiFetch(organisationUrl(input.organisationId), {
      method: "PATCH",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...input.values,
        expectedProfileEtag: input.expectedProfileEtag,
      }),
    }),
  );
}

async function setOrganisationActive(input: {
  organisationId: string;
  expectedProfileEtag: string;
  action: "suspend" | "unsuspend";
}): Promise<OrganisationProfile> {
  return readOrganisation(
    await apiFetch(`${organisationUrl(input.organisationId)}/${input.action}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedProfileEtag: input.expectedProfileEtag }),
    }),
  );
}

export function suspendOrganisation(input: {
  organisationId: string;
  expectedProfileEtag: string;
}) {
  return setOrganisationActive({ ...input, action: "suspend" });
}

export function unsuspendOrganisation(input: {
  organisationId: string;
  expectedProfileEtag: string;
}) {
  return setOrganisationActive({ ...input, action: "unsuspend" });
}
