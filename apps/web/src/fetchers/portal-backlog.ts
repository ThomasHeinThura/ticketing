import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type PortalBacklogItem = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectKey: string;
  projectName: string;
  stateId: string;
  stateName: string;
  statePosition: number;
  position: string;
  version: number;
  sourceRef: string;
};

export type PortalBacklogPage = {
  items: PortalBacklogItem[];
  page: { nextCursor: string | null; hasMore: boolean };
};

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Unable to update your backlog"),
    );
  return response.json() as Promise<T>;
}

export function getPortalBacklog(cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  return request<PortalBacklogPage>(`/portal/requests/backlog${query}`);
}

export function rankPortalBacklogItem(input: {
  key: string;
  beforeId?: string;
  afterId?: string;
}) {
  return request<{ key: string; position: string; version: number }>(
    "/portal/requests/rank",
    { method: "POST", body: input },
  );
}
