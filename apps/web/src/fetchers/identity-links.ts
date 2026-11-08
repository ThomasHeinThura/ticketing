import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError } from "@/lib/http-error";

export type IdentityLinkTarget = {
  connectionId: string;
  displayName: string;
  linked: boolean;
};

export type IdentityLinkList = {
  source: { connectionId: string; displayName: string };
  targets: IdentityLinkTarget[];
};

export type IdentityLinkIntent = {
  intentId: string;
  sourceDisplayName: string;
  targetDisplayName: string;
  accountLabel: string | null;
  displayName: string | null;
  expiresAt: string;
};

export type IdentityLinkConfirmation = {
  linked: true;
  alreadyLinked: boolean;
};

const IDENTITY_LINK_BASE = "/me/identity-links";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    ...init,
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "Identity link request failed");
  try {
    return (await response.json()) as T;
  } catch {
    throw new HttpError(502, "Identity link response was invalid");
  }
}

/**
 * The current provider and the providers it can link to, or `null` when this session cannot
 * link identities: the API answers 403 for a session not started through an identity provider
 * (a password session). That is an expected state the panel explains, not an error to log
 * (UX-8). Every other refusal still throws.
 */
export async function getIdentityLinks(): Promise<IdentityLinkList | null> {
  try {
    return await requestJson<IdentityLinkList>(IDENTITY_LINK_BASE);
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return null;
    throw error;
  }
}

export async function startIdentityLink(
  targetConnectionId: string,
): Promise<{ authorizationUrl: string }> {
  return requestJson<{ authorizationUrl: string }>(
    `${IDENTITY_LINK_BASE}/${encodeURIComponent(targetConnectionId)}/start`,
    { method: "POST" },
  );
}

function assertIntentId(intentId: string) {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(intentId))
    throw new HttpError(400, "Identity link intent is invalid");
}

export async function getIdentityLinkIntent(
  intentId: string,
): Promise<IdentityLinkIntent> {
  assertIntentId(intentId);
  return requestJson<IdentityLinkIntent>(
    `${IDENTITY_LINK_BASE}/intents/${encodeURIComponent(intentId)}`,
  );
}

export async function confirmIdentityLink(
  intentId: string,
): Promise<IdentityLinkConfirmation> {
  assertIntentId(intentId);
  return requestJson<IdentityLinkConfirmation>(
    `${IDENTITY_LINK_BASE}/intents/${encodeURIComponent(intentId)}/confirm`,
    { method: "POST" },
  );
}
