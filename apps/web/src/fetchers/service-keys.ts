import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import type { ApiKey, CreateApiKeyResponse } from "@/types/api-key";

/** `X-TaskDesk-Step-Up-Token`: the one-use PA-15 proof an elevated write spends. */
const STEP_UP_HEADER = "X-TaskDesk-Step-Up-Token";

async function ensureOk(response: Response, message: string) {
  if (response.ok) return;
  throw new HttpError(
    response.status,
    response.status === 400 || response.status === 403
      ? await readErrorDetail(response, message)
      : message,
  );
}

const base = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/api-keys`;

/** AK-7: the workspace's service keys. A 403 means the caller does not hold `api_key:manage`. */
export async function listServiceKeys(workspaceId: string): Promise<ApiKey[]> {
  const response = await apiFetch(getApiUrl(base(workspaceId)), {
    credentials: "include",
    cache: "no-store",
  });
  await ensureOk(response, "Unable to load service keys");
  return ((await response.json()) as { apiKeys: ApiKey[] }).apiKeys;
}

export type CreateServiceKeyInput = {
  name: string;
  /** Seconds until expiry; null for none. */
  expiresIn: number | null;
  /** The frozen subset; the API bounds it by the creator's own authority. */
  capabilities: string[];
  ipAllowlist?: string[];
};

/** Elevated: spends the proof bound to this exact body (`service_key_create`). */
export async function createServiceKey(
  workspaceId: string,
  input: CreateServiceKeyInput,
  stepUpToken: string,
): Promise<CreateApiKeyResponse> {
  const response = await apiFetch(getApiUrl(base(workspaceId)), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      [STEP_UP_HEADER]: stepUpToken,
    },
    body: JSON.stringify(input),
  });
  await ensureOk(response, "Failed to create the service key");
  return (await response.json()) as CreateApiKeyResponse;
}

export async function revokeServiceKey(
  workspaceId: string,
  keyId: string,
): Promise<ApiKey> {
  const response = await apiFetch(
    getApiUrl(`${base(workspaceId)}/${encodeURIComponent(keyId)}/revoke`),
    { method: "POST", credentials: "include" },
  );
  await ensureOk(response, "Failed to revoke the service key");
  return (await response.json()) as ApiKey;
}

/** Elevated acknowledgement, bound to the current accountability version. */
export async function reattestServiceKey(
  workspaceId: string,
  keyId: string,
  expectedVersion: number,
  stepUpToken: string,
): Promise<ApiKey> {
  const response = await apiFetch(
    getApiUrl(`${base(workspaceId)}/${encodeURIComponent(keyId)}/re-attest`),
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        [STEP_UP_HEADER]: stepUpToken,
      },
      body: JSON.stringify({ expectedVersion }),
    },
  );
  await ensureOk(response, "Failed to re-attest the service key");
  return (await response.json()) as ApiKey;
}

/**
 * AK-11: deleting a service key only opens a typed-name + step-up pending action; nothing is
 * deleted until the requester approves it in the browser.
 */
export async function requestServiceKeyDeletion(
  workspaceId: string,
  keyId: string,
): Promise<{ pendingActionId: string }> {
  const response = await apiFetch(
    getApiUrl(`${base(workspaceId)}/${encodeURIComponent(keyId)}`),
    { method: "DELETE", credentials: "include" },
  );
  return readPendingDeletion(response, "Failed to request the deletion");
}
