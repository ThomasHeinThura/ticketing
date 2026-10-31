import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/** The fields the top-bar project selector needs from `GET /api/portal/projects` (p3, S4c). */
export type PortalProjectOption = { key: string; name: string };

export async function getPortalProjects(): Promise<{
  data: PortalProjectOption[];
}> {
  const response = await apiFetch(getApiUrl("/portal/projects"), {
    credentials: "include",
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to load projects"),
    );
  return response.json() as Promise<{ data: PortalProjectOption[] }>;
}
