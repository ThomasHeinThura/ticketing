import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type PortalReleaseSummary = {
  id: string;
  name: string;
  serviceName: string;
  plannedDate: string | null;
  notes: string | null;
  publishedAt: string;
};

export type PortalReleasePage = {
  data: PortalReleaseSummary[];
  nextCursor: string | null;
};

async function request<T>(path: string): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    credentials: "include",
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to load release notes"),
    );
  return response.json() as Promise<T>;
}

export function getPortalReleases(
  input: { limit?: number; cursor?: string } = {},
) {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  return request<PortalReleasePage>(`/portal/releases?${params.toString()}`);
}

export function getPortalRelease(id: string) {
  return request<PortalReleaseSummary>(
    `/portal/releases/${encodeURIComponent(id)}`,
  );
}
