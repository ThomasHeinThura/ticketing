import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export const ANNOUNCEMENT_SEVERITIES = [
  "info",
  "maintenance",
  "incident",
] as const;
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];
export const ANNOUNCEMENT_AUDIENCES = [
  "workspace",
  "organisations",
  "projects",
] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

type Named = { id: string; name: string };

export type Announcement = {
  id: string;
  workspaceId: string;
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  organisations: Named[];
  projects: Named[];
  startsAt: string;
  endsAt: string | null;
  publishedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /**
   * False when the notice addresses customers outside the caller's reach: they cannot publish it,
   * or edit, unpublish or delete it once published (the API answers 422).
   */
  reachesAudience: boolean;
};

export type AnnouncementAudienceOptions = {
  /** False when the caller does not reach every customer project: "all customers" is refused. */
  canAddressWorkspace: boolean;
  organisations: Named[];
  projects: Array<Named & { organisationId: string; organisationName: string }>;
};

export type AnnouncementInput = {
  title: string;
  body: string;
  severity: AnnouncementSeverity;
  audience: AnnouncementAudience;
  organisationIds: string[];
  projectIds: string[];
  startsAt?: string;
  endsAt: string | null;
};

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

const enc = encodeURIComponent;

export async function listAnnouncements(workspaceId: string) {
  const result = await request<{ data: Announcement[] }>(
    `/announcements?workspaceId=${enc(workspaceId)}`,
    {},
    "Failed to load announcements",
  );
  return result.data;
}

export function getAnnouncementAudienceOptions(workspaceId: string) {
  return request<AnnouncementAudienceOptions>(
    `/announcements/audience-options?workspaceId=${enc(workspaceId)}`,
    {},
    "Failed to load the audience options",
  );
}

export function createAnnouncement(
  workspaceId: string,
  input: AnnouncementInput,
) {
  return request<Announcement>(
    "/announcements",
    { method: "POST", body: { workspaceId, ...input } },
    "Failed to create the announcement",
  );
}

export function updateAnnouncement(
  id: string,
  input: AnnouncementInput & { version: number },
) {
  return request<Announcement>(
    `/announcements/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the announcement",
  );
}

export function setAnnouncementPublished(
  id: string,
  version: number,
  published: boolean,
) {
  return request<Announcement>(
    `/announcements/${enc(id)}/${published ? "publish" : "unpublish"}`,
    { method: "POST", body: { version } },
    published
      ? "Failed to publish the announcement"
      : "Failed to unpublish the announcement",
  );
}

/** Requests deletion; the announcement stays until the requester approves it. */
export async function requestAnnouncementDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/announcements/${enc(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the announcement deletion",
  );
}
