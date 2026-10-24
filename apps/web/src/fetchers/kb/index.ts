import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type ArticleState = "draft" | "in_review" | "published" | "archived";

export type KbArticleSummary = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  categoryId: string | null;
  title: string;
  snippet: string;
  state: ArticleState;
  customerVisible: boolean;
  ownerId: string | null;
  ownerName: string | null;
  authorId: string | null;
  authorName: string | null;
  reviewDueAt: string | null;
  overdue: boolean;
  viewCount: number;
  publishedAt: string | null;
  publishedVersion: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type KbArticle = KbArticleSummary & {
  body: unknown;
  hasUnpublishedChanges: boolean;
  versionCount: number;
  categoryName: string | null;
};

export type KbArticleDetail = {
  article: KbArticle;
  related: KbArticleSummary[];
  canPublish: boolean;
  canWrite: boolean;
  reviewStepEnabled: boolean;
};

export type KbCategory = {
  id: string;
  workspaceId: string;
  name: string;
  parentId: string | null;
  position: number;
  articleCount: number;
};

export type KbVersionSummary = {
  number: number;
  title: string;
  createdAt: string;
  createdByName: string | null;
  current: boolean;
};

export type KbVersion = {
  number: number;
  title: string;
  body: unknown;
  createdAt: string;
  current: boolean;
};

export type KbFeedback = {
  helpful: number;
  notHelpful: number;
  comments: { helpful: boolean; comment: string; createdAt: string }[];
};

export type KbSettings = {
  reviewStepEnabled: boolean;
  canWrite: boolean;
  canPublish: boolean;
  canManageSettings: boolean;
};

export type KbReport = {
  overdue: KbArticleSummary[];
  unhelpful: {
    id: string;
    title: string;
    viewCount: number;
    helpful: number;
    notHelpful: number;
  }[];
  deflection: {
    windowDays: number;
    candidates: number;
    deflected: number;
    articles: {
      id: string;
      title: string;
      candidates: number;
      deflected: number;
    }[];
  };
};

/** `409` from an edit: somebody saved first. Carries the stored article so the screen can diff. */
export class KbVersionConflictError extends HttpError {
  readonly current: KbArticle;
  constructor(current: KbArticle) {
    super(409, "The article changed since it was loaded");
    this.name = "KbVersionConflictError";
    this.current = current;
  }
}

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
  if (response.status === 409) {
    const text = await response.clone().text();
    try {
      const body = JSON.parse(text) as {
        error?: string;
        current?: KbArticle;
      };
      if (body.error === "version_conflict" && body.current)
        throw new KbVersionConflictError(body.current);
    } catch (error) {
      if (error instanceof KbVersionConflictError) throw error;
    }
  }
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, fallback),
    );
  return response.json() as Promise<T>;
}

const enc = encodeURIComponent;
function query(entries: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}

export type KbListParams = {
  workspaceId: string;
  q?: string;
  state?: ArticleState;
  categoryId?: string;
  overdue?: boolean;
  sort?: "updated" | "views" | "title";
  limit?: number;
  offset?: number;
};

export function getKbArticles(params: KbListParams) {
  return request<{ articles: KbArticleSummary[]; total: number }>(
    `/kb/articles?${query({ ...params, overdue: params.overdue ? "true" : undefined })}`,
    {},
    "Failed to load the articles",
  );
}

export function getKbArticle(id: string) {
  return request<KbArticleDetail>(
    `/kb/articles/${enc(id)}`,
    {},
    "Failed to load the article",
  );
}

export type KbArticleInput = {
  title?: string;
  body?: unknown;
  projectId?: string | null;
  categoryId?: string | null;
  customerVisible?: boolean;
  ownerId?: string | null;
  reviewDueAt?: string | null;
};

export function createKbArticle(
  workspaceId: string,
  input: KbArticleInput & { title: string },
) {
  return request<KbArticle>(
    "/kb/articles",
    { method: "POST", body: { workspaceId, ...input } },
    "Failed to create the article",
  );
}

export function updateKbArticle(
  id: string,
  version: number,
  input: KbArticleInput,
) {
  return request<KbArticle>(
    `/kb/articles/${enc(id)}`,
    { method: "PATCH", body: { version, ...input } },
    "Failed to save the article",
  );
}

export type KbTransition =
  | "submit"
  | "publish"
  | "unpublish"
  | "archive"
  | "restore";
export function transitionKbArticle(
  id: string,
  version: number,
  action: KbTransition,
) {
  return request<KbArticle>(
    `/kb/articles/${enc(id)}/${action}`,
    { method: "POST", body: { version } },
    "Failed to change the article",
  );
}

export function getKbVersions(id: string) {
  return request<{ versions: KbVersionSummary[] }>(
    `/kb/articles/${enc(id)}/versions`,
    {},
    "Failed to load the history",
  );
}
export function getKbVersion(id: string, number: number) {
  return request<KbVersion>(
    `/kb/articles/${enc(id)}/versions/${number}`,
    {},
    "Failed to load the version",
  );
}
export function restoreKbVersion(id: string, number: number, version: number) {
  return request<KbArticle>(
    `/kb/articles/${enc(id)}/versions/${number}/restore`,
    { method: "POST", body: { version } },
    "Failed to restore the version",
  );
}
export function getKbFeedback(id: string) {
  return request<KbFeedback>(
    `/kb/articles/${enc(id)}/feedback`,
    {},
    "Failed to load the feedback",
  );
}

export function getKbCategories(workspaceId: string) {
  return request<{ categories: KbCategory[] }>(
    `/kb/categories?${query({ workspaceId })}`,
    {},
    "Failed to load the categories",
  );
}
export function createKbCategory(
  workspaceId: string,
  input: { name: string; parentId?: string | null },
) {
  return request<KbCategory>(
    "/kb/categories",
    { method: "POST", body: { workspaceId, ...input } },
    "Failed to create the category",
  );
}
export function updateKbCategory(
  id: string,
  input: { name?: string; parentId?: string | null },
) {
  return request<KbCategory>(
    `/kb/categories/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the category",
  );
}
/** Requests deletion; the category stays until the requester approves it. */
export async function requestKbCategoryDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/kb/categories/${enc(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the category deletion",
  );
}

export function getKbSettings(workspaceId: string) {
  return request<KbSettings>(
    `/kb/settings?${query({ workspaceId })}`,
    {},
    "Failed to load the settings",
  );
}
export function updateKbSettings(
  workspaceId: string,
  reviewStepEnabled: boolean,
) {
  return request<KbSettings>(
    `/kb/settings?${query({ workspaceId })}`,
    { method: "PATCH", body: { reviewStepEnabled } },
    "Failed to save the settings",
  );
}
export function getKbReport(workspaceId: string) {
  return request<KbReport>(
    `/kb/report?${query({ workspaceId })}`,
    {},
    "Failed to load the report",
  );
}
/** KB-12: published articles matching free text, for the triager. */
export function getKbSuggestions(workspaceId: string, q: string) {
  return request<{
    articles: KbArticleSummary[];
    portalBaseUrl: string | null;
  }>(
    `/kb/deflection?${query({ workspaceId, q })}`,
    {},
    "Failed to load the suggestions",
  );
}
