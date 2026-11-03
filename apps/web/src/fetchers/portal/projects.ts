import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type PortalProjectKind = "project" | "managed_service";

export type PortalDocumentKind =
  | "contract"
  | "sow"
  | "design"
  | "handover"
  | "other";

export type PortalProjectCounts = {
  /**
   * Readable requests that need more information (colleagues' and staff-raised included) plus
   * approvals addressed to the caller (same rules as `GET /api/portal/home`).
   */
  actionRequired: number;
  /** Requests received, needing more information or in progress. */
  outstanding: number;
};

/** One row of `GET /api/portal/projects` (p3, S4c). The top-bar selector reads key and name. */
export type PortalProjectOption = {
  key: string;
  name: string;
  kind: PortalProjectKind;
  status: string;
  health: string | null;
  counts: PortalProjectCounts;
};

export type PortalProjectDetail = PortalProjectOption & {
  description: string | null;
  createdAt: string;
  supportLevel: string | null;
  serviceCalendarName: string | null;
  summary: {
    objective: string | null;
    inScope: string | null;
    outOfScope: string | null;
    successCriteria: string | null;
  };
  goLive: { name: string; date: string; reached: boolean } | null;
  milestones: Array<{
    id: string;
    name: string;
    date: string;
    reachedAt: string | null;
  }>;
  prerequisites: Array<{
    id: string;
    title: string;
    dueDate: string | null;
    completedAt: string | null;
  }>;
  /** Customer-visible Documents entries only; Pages never appear in the portal. */
  documents: Array<{
    id: string;
    title: string;
    url: string;
    kind: PortalDocumentKind;
    description: string | null;
  }>;
  contacts: Array<{
    kind: "manager" | "stakeholder";
    role: string | null;
    name: string | null;
    email: string | null;
  }>;
  contract: {
    startDate: string;
    endDate: string;
    period: {
      state: "upcoming" | "active" | "ended";
      totalDays: number;
      elapsedDays: number;
      daysRemaining: number;
      elapsedPct: number;
    };
    hours: {
      contractedMinutes: number;
      usedMinutes: number;
      remainingMinutes: number;
      usedPct: number;
    };
  } | null;
};

export const portalProjectKeys = {
  all: ["portal", "projects"] as const,
  list: () => ["portal", "projects", "list"] as const,
  detail: (key: string) => ["portal", "projects", "detail", key] as const,
};

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

export async function getPortalProject(
  key: string,
): Promise<PortalProjectDetail> {
  const response = await apiFetch(
    getApiUrl(`/portal/projects/${encodeURIComponent(key)}`),
    { credentials: "include" },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to load the project"),
    );
  return response.json() as Promise<PortalProjectDetail>;
}
