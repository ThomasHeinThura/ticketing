import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type PortalKbSummary = {
  id: string;
  title: string;
  snippet: string;
  categoryId: string | null;
  publishedAt: string | null;
};
export type PortalKbCategory = {
  id: string;
  name: string;
  parentId: string | null;
  position: number;
  articleCount: number;
};
export type PortalKbArticle = PortalKbSummary & {
  categoryName: string | null;
  body: unknown;
  related: PortalKbSummary[];
  myFeedback: { helpful: boolean; comment: string | null } | null;
};

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; keepalive?: boolean } = {},
  fallback = "The request failed",
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.keepalive ? { keepalive: true } : {}),
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

export function getPortalKb(params: {
  q?: string;
  categoryId?: string;
  sort?: "recent" | "popular";
  limit?: number;
  offset?: number;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") query.set(key, String(value));
  return request<{ articles: PortalKbSummary[]; total: number }>(
    `/portal/kb?${query}`,
    {},
    "Failed to load the articles",
  );
}
export function getPortalKbCategories() {
  return request<{ categories: PortalKbCategory[] }>(
    "/portal/kb/categories",
    {},
    "Failed to load the categories",
  );
}
export function getPortalKbArticle(id: string) {
  return request<PortalKbArticle>(
    `/portal/kb/${enc(id)}`,
    {},
    "Failed to load the article",
  );
}
export function sendPortalKbFeedback(
  id: string,
  input: { helpful: boolean; comment?: string },
) {
  return request<{ ok: true }>(
    `/portal/kb/${enc(id)}/feedback`,
    { method: "POST", body: input },
    "Failed to send your answer",
  );
}
/** KB-8: suggestions while a request summary is typed. */
export function getPortalKbSuggestions(q: string) {
  return request<{ articles: PortalKbSummary[] }>(
    `/portal/kb/deflection?${new URLSearchParams({ q })}`,
    {},
    "Failed to load the suggestions",
  );
}
/** KB-10: an article was opened from the request form. */
export function recordPortalKbCandidate(input: {
  articleId: string;
  requestTypeKey?: string;
  query: string;
}) {
  return request<{ id: string }>(
    "/portal/kb/deflection",
    { method: "POST", body: input },
    "Failed to record the article",
  );
}
/** KB-10: the customer left the form without submitting; sent with `keepalive` so it survives unload. */
export function abandonPortalKbCandidate(id: string) {
  return request<{ ok: true }>(
    `/portal/kb/deflection/${enc(id)}/abandon`,
    { method: "POST", body: {}, keepalive: true },
    "Failed to record the outcome",
  );
}
