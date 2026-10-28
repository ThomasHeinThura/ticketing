import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import type {
  ApiKey,
  CreateApiKeyClientRequest,
  CreateApiKeyResponse,
} from "@/types/api-key";

async function ensureOk(response: Response, message: string) {
  if (response.ok) return;
  // 400/403 carry the API's reason (an unknown capability, a missing browser session).
  throw new HttpError(
    response.status,
    response.status === 400 || response.status === 403
      ? await readErrorDetail(response, message)
      : message,
  );
}

export async function getMyApiKeys(): Promise<ApiKey[]> {
  const response = await apiFetch(getApiUrl("/me/api-keys"), {
    credentials: "include",
    cache: "no-store",
  });
  await ensureOk(response, "Unable to load API keys");
  return ((await response.json()) as { apiKeys: ApiKey[] }).apiKeys;
}

export async function createMyApiKey(
  input: CreateApiKeyClientRequest,
): Promise<CreateApiKeyResponse> {
  const response = await apiFetch(getApiUrl("/me/api-keys"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  await ensureOk(response, "Failed to create API key");
  return (await response.json()) as CreateApiKeyResponse;
}

export async function revokeMyApiKey(id: string): Promise<ApiKey> {
  const response = await apiFetch(
    getApiUrl(`/me/api-keys/${encodeURIComponent(id)}/revoke`),
    { method: "POST", credentials: "include" },
  );
  await ensureOk(response, "Failed to revoke API key");
  return (await response.json()) as ApiKey;
}

/** Requests PA-3 deletion. The key stays until the same human approves in the browser. */
export async function requestDeleteMyApiKey(
  id: string,
): Promise<{ pendingActionId: string }> {
  const response = await apiFetch(
    getApiUrl(`/me/api-keys/${encodeURIComponent(id)}`),
    { method: "DELETE", credentials: "include" },
  );
  return readPendingDeletion(response, "Unable to request API key deletion");
}
