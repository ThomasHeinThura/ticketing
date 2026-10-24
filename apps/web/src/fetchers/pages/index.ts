import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/** Project pages (`PG-1`..`PG-8`): staff-only versioned documents next to a project's work. */

export type PagePerson = { id: string; name: string | null };

export type PageSummary = {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  snippet: string;
  version: number;
  updatedBy: PagePerson | null;
  createdAt: string;
  updatedAt: string;
};

export type PageList = { pages: PageSummary[]; canEdit: boolean };

export type Page = PageSummary & {
  body: Record<string, unknown>;
  createdBy: PagePerson | null;
  canEdit: boolean;
};

export type PageVersionSummary = {
  number: number;
  title: string;
  kind: "create" | "edit" | "restore";
  restoredFrom: number | null;
  createdBy: PagePerson | null;
  createdAt: string;
};

export type PageVersion = PageVersionSummary & {
  body: Record<string, unknown>;
};

export type PageInput = {
  title?: string;
  body?: unknown;
  parentId?: string | null;
};

/** `409 page_version_conflict` (`PG-5`): the page moved on; nothing was written. */
export class PageConflictError extends HttpError {
  currentVersion: number;
  currentTitle: string;
  updatedBy: PagePerson | null;
  updatedAt: string;
  constructor(body: {
    currentVersion: number;
    currentTitle: string;
    updatedBy: PagePerson | null;
    updatedAt: string;
  }) {
    super(409, "page_version_conflict");
    this.name = "PageConflictError";
    this.currentVersion = body.currentVersion;
    this.currentTitle = body.currentTitle;
    this.updatedBy = body.updatedBy;
    this.updatedAt = body.updatedAt;
  }
}

async function failure(response: Response, fallback: string): Promise<never> {
  if (response.status === 409) {
    try {
      const body = (await response.clone().json()) as Record<string, unknown>;
      if (
        body.message === "page_version_conflict" &&
        typeof body.currentVersion === "number"
      )
        throw new PageConflictError({
          currentVersion: body.currentVersion,
          currentTitle: String(body.currentTitle ?? ""),
          updatedBy: (body.updatedBy as PagePerson | null) ?? null,
          updatedAt: String(body.updatedAt ?? ""),
        });
    } catch (error) {
      if (error instanceof PageConflictError) throw error;
    }
  }
  throw new HttpError(
    response.status,
    await readErrorDetail(response, fallback),
  );
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  fallback = "The request failed",
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.method && init.method !== "GET"
      ? { headers: { "Content-Type": "application/json" } }
      : {}),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) await failure(response, fallback);
  return (await response.json()) as T;
}

const enc = encodeURIComponent;
const base = (projectKey: string) => `/projects/${enc(projectKey)}/pages`;

export const pageKeys = {
  all: ["pages"] as const,
  list: (projectKey: string) => ["pages", "list", projectKey] as const,
  detail: (projectKey: string, id: string) =>
    ["pages", "detail", projectKey, id] as const,
  versions: (projectKey: string, id: string) =>
    ["pages", "versions", projectKey, id] as const,
  version: (projectKey: string, id: string, number: number) =>
    ["pages", "version", projectKey, id, number] as const,
};

export const getPages = (projectKey: string) =>
  request<PageList>(base(projectKey), {}, "Failed to load pages");

export const createPage = (
  projectKey: string,
  input: { title: string; parentId?: string | null },
) =>
  request<Page>(
    base(projectKey),
    { method: "POST", body: input },
    "Failed to create the page",
  );

export const getPage = (projectKey: string, id: string) =>
  request<Page>(
    `${base(projectKey)}/${enc(id)}`,
    {},
    "Failed to load the page",
  );

export const savePage = (
  projectKey: string,
  id: string,
  expectedVersion: number,
  input: PageInput,
) =>
  request<Page>(
    `${base(projectKey)}/${enc(id)}`,
    { method: "PATCH", body: { expectedVersion, ...input } },
    "Failed to save the page",
  );

export const getPageVersions = (projectKey: string, id: string) =>
  request<{ versions: PageVersionSummary[] }>(
    `${base(projectKey)}/${enc(id)}/versions`,
    {},
    "Failed to load the history",
  );

export const getPageVersion = (
  projectKey: string,
  id: string,
  number: number,
) =>
  request<PageVersion>(
    `${base(projectKey)}/${enc(id)}/versions/${number}`,
    {},
    "Failed to load the version",
  );

export const restorePageVersion = (
  projectKey: string,
  id: string,
  number: number,
  expectedVersion: number,
) =>
  request<Page>(
    `${base(projectKey)}/${enc(id)}/restore`,
    { method: "POST", body: { number, expectedVersion } },
    "Failed to restore the version",
  );

export async function requestPageDeletion(projectKey: string, id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`${base(projectKey)}/${enc(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the page deletion",
  );
}
