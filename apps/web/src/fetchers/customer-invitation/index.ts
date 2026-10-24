import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type CustomerInvitationStatus =
  | "pending"
  | "accepted"
  | "revoked"
  | "expired";

/** The accept credential is never part of this shape (CP-23). */
export type CustomerInvitation = {
  id: string;
  organisationId: string;
  email: string;
  status: CustomerInvitationStatus;
  expiresAt: string;
  createdAt: string;
  lastSentAt: string | null;
  acceptedAt: string | null;
  inviterId: string;
};

export type SentCustomerInvitation = CustomerInvitation & {
  /** Whether the email was handed to the mailer; false means a resend is needed. */
  delivered: boolean;
};

export type InvitableOrganisation = { id: string; key: string; name: string };

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  fallback = "The request failed",
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, fallback),
    );
  return response.json() as Promise<T>;
}

const orgBase = (workspaceId: string, organisationId: string) =>
  `/workspace/${encodeURIComponent(workspaceId)}/organisations/${encodeURIComponent(organisationId)}/invitations`;

export async function listInvitableOrganisations(
  workspaceId: string,
): Promise<InvitableOrganisation[]> {
  const result = await request<{ organisations: InvitableOrganisation[] }>(
    `/workspace/${encodeURIComponent(workspaceId)}/customer-organisations`,
    {},
    "Failed to load the customer organisations",
  );
  return result.organisations;
}

export async function listCustomerInvitations(
  workspaceId: string,
  organisationId: string,
): Promise<CustomerInvitation[]> {
  const result = await request<{ invitations: CustomerInvitation[] }>(
    orgBase(workspaceId, organisationId),
    {},
    "Failed to load the invitations",
  );
  return result.invitations;
}

export function createCustomerInvitation(
  workspaceId: string,
  organisationId: string,
  email: string,
) {
  return request<SentCustomerInvitation>(
    orgBase(workspaceId, organisationId),
    { method: "POST", body: { email } },
    "Failed to send the invitation",
  );
}

export function resendCustomerInvitation(
  workspaceId: string,
  organisationId: string,
  id: string,
) {
  return request<SentCustomerInvitation>(
    `${orgBase(workspaceId, organisationId)}/${encodeURIComponent(id)}/resend`,
    { method: "POST" },
    "Failed to resend the invitation",
  );
}

/** Revoke is the existing pending-action route; the invitation stays valid until approved. */
export async function requestCustomerInvitationRevoke(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/invitation/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the revocation",
  );
}

/**
 * Portal accept (CP-24). Every non-valid state is one generic 404, so the caller learns only
 * that the invitation could not be accepted, never why.
 */
export async function acceptCustomerInvitation(
  id: string,
  credential: string,
): Promise<void> {
  const response = await apiFetch(
    getApiUrl(`/portal/invitations/${encodeURIComponent(id)}/accept`),
    {
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ credential }),
    },
  );
  if (!response.ok) throw new HttpError(response.status, "invitation_invalid");
}
