import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";

export type AuditRow = {
  id: string;
  seq: string;
  createdAt: string;
  actorId: string | null;
  actorType: string;
  impersonatorId: string | null;
  workspaceId: string | null;
  organisationId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
};

export type AuditListResponse = {
  rows: AuditRow[];
};

export type AuditFilterQuery = {
  limit?: number;
  action?: string;
  since?: string;
  until?: string;
};

export async function getInstanceAudit(
  query?: AuditFilterQuery,
): Promise<AuditListResponse> {
  const params = new URLSearchParams();
  if (query?.limit) params.set("limit", String(query.limit));
  if (query?.action) params.set("action", query.action);
  if (query?.since) params.set("since", query.since);
  if (query?.until) params.set("until", query.until);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(getApiUrl(`/instance/audit${suffix}`), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "Unable to load audit log");
  }
  return response.json();
}
