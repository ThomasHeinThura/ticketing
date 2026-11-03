import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import type { PortalSla } from "@/lib/portal-request";
import type {
  PortalCasePriority,
  PortalCaseSort,
  PortalCaseStatus,
} from "@/lib/routes";

/** One row of `GET /api/portal/requests` (S4b). There is no assignee field (CP-4). */
export type PortalCase = {
  ref: string;
  /** `submission` rows open `/submissions/$ref`; `direct` rows (raised by staff) open `/requests/$ref`. */
  source: "submission" | "direct";
  title: string;
  requestTypeName: string;
  priority: PortalCasePriority | null;
  customerStatus: PortalCaseStatus;
  createdAt: string;
  updatedAt: string;
  project: { key: string; name: string } | null;
  createdBy: { name: string | null; isYou: boolean };
  isRequester: boolean;
  customerVisibility: "private" | "organisation";
  sla: PortalSla | null;
};

export type PortalCasePage = {
  cases: PortalCase[];
  page: { nextCursor: string | null; hasMore: boolean };
  meta: { total: number };
};

export type PortalHome = {
  actionRequired: { total: number; cases: number; approvals: number };
  outstanding: number;
  closedLast30Days: number;
  averageFirstResponse: { seconds: number; sampleSize: number } | null;
};

export type PortalMe = {
  name: string | null;
  email: string;
  image: string | null;
  jobTitle: string | null;
  organisation: { name: string };
};

/** The API's case filters; the web keeps `scope=mine` as its default. */
export type PortalCaseQuery = {
  scope: "mine" | "all";
  status?: string;
  priority?: string;
  project?: string;
  q?: string;
  from?: string;
  to?: string;
  sort?: PortalCaseSort;
  cursor?: string;
  limit?: number;
};

export function portalCaseQueryString(query: PortalCaseQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return params.toString();
}

async function readJson<T>(path: string, fallback: string): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    credentials: "include",
  });
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, fallback),
    );
  return response.json() as Promise<T>;
}

export function getPortalCases(query: PortalCaseQuery) {
  return readJson<PortalCasePage>(
    `/portal/requests?${portalCaseQueryString(query)}`,
    "Failed to load requests",
  );
}

export function getPortalHome(project?: string) {
  return readJson<PortalHome>(
    `/portal/home${project ? `?${new URLSearchParams({ project })}` : ""}`,
    "Failed to load the dashboard",
  );
}

export function getPortalMe() {
  return readJson<PortalMe>("/portal/me", "Failed to load your profile");
}

/** The CSV download link for the same filters (no cursor or page size). */
export function portalCaseExportUrl(query: PortalCaseQuery) {
  const { cursor: _cursor, limit: _limit, ...filters } = query;
  return getApiUrl(
    `/portal/requests/export.csv?${portalCaseQueryString(filters)}`,
  );
}
