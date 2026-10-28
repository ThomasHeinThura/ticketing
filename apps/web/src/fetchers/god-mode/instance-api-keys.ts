import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import type { ApiKey } from "@/types/api-key";

export type InstanceApiKey = ApiKey & {
  ownerName: string | null;
  workspaceName: string | null;
};

/** AK-7: God Mode's inventory of every key (never a secret or hash). */
export async function listInstanceApiKeys(
  limit = 100,
): Promise<{ apiKeys: InstanceApiKey[]; hasMore: boolean }> {
  const response = await apiFetch(
    getApiUrl(`/instance/api-keys?limit=${limit}`),
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Unable to load API keys"),
    );
  return (await response.json()) as {
    apiKeys: InstanceApiKey[];
    hasMore: boolean;
  };
}
