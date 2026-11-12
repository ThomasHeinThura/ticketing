import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import {
  HttpError,
  httpErrorFromResponse,
  readErrorDetail,
} from "@/lib/http-error";

export type PortalAnnouncementSeverity = "info" | "maintenance" | "incident";

export type PortalAnnouncement = {
  id: string;
  title: string;
  body: string;
  severity: PortalAnnouncementSeverity;
  startsAt: string;
  endsAt: string | null;
  publishedAt: string;
};

export type PortalAnnouncementPage = {
  data: PortalAnnouncement[];
  nextCursor: string | null;
};

async function request<T>(path: string): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    credentials: "include",
  });
  if (response.status >= 500)
    throw await httpErrorFromResponse(response, "The request failed");
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to load announcements"),
    );
  return response.json() as Promise<T>;
}

export function getPortalAnnouncements(
  input: {
    limit?: number;
    cursor?: string;
    severities?: readonly PortalAnnouncementSeverity[];
  } = {},
) {
  const params = new URLSearchParams();
  if (input.limit !== undefined) params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.severities?.length)
    params.set("severity", input.severities.join(","));
  return request<PortalAnnouncementPage>(
    `/portal/announcements?${params.toString()}`,
  );
}

export function getPortalAnnouncement(id: string) {
  return request<PortalAnnouncement>(
    `/portal/announcements/${encodeURIComponent(id)}`,
  );
}
