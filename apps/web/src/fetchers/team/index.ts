import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";

export type Team = {
  id: string;
  workspaceId: string;
  name: string;
  isCab: boolean;
  capacityDaysPerWeek: number | null;
  memberCount: number;
  createdAt: string;
};

export type TeamMember = {
  personId: string;
  userId: string;
  name: string | null;
  isLead: boolean;
  allocationPct: number | null;
  active: boolean;
};

export type TeamCandidate = { personId: string; name: string; email: string };

export type TeamDetail = Team & {
  members: TeamMember[];
  candidates: TeamCandidate[];
  canEditRoster: boolean;
  canManageTeam: boolean;
  deletionBlockers: string[];
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

export async function getTeams(workspaceId: string): Promise<Team[]> {
  const query = new URLSearchParams({ workspaceId });
  const result = await request<{ data: Team[] }>(
    `/teams?${query}`,
    {},
    "Failed to load teams",
  );
  return result.data;
}

export function getTeam(id: string, includeInactive = false) {
  const suffix = includeInactive ? "?includeInactive=true" : "";
  return request<TeamDetail>(
    `/teams/${encodeURIComponent(id)}${suffix}`,
    {},
    "Failed to load the team",
  );
}

export type TeamInput = {
  name: string;
  capacityDaysPerWeek?: number | null;
  isCab?: boolean;
};

export function createTeam(workspaceId: string, input: TeamInput) {
  return request<Team>(
    "/teams",
    { method: "POST", body: { workspaceId, ...input } },
    "Failed to create the team",
  );
}

export function updateTeam(id: string, input: Partial<TeamInput>) {
  return request<Team>(
    `/teams/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the team",
  );
}

/** TM-7: requests deletion; the team stays until the requester approves it. */
export async function requestTeamDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/teams/${encodeURIComponent(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the team deletion",
  );
}

export function addTeamMember(
  id: string,
  input: { personId: string; isLead?: boolean; allocationPct?: number | null },
) {
  return request(
    `/teams/${encodeURIComponent(id)}/members`,
    { method: "POST", body: input },
    "Failed to add the member",
  );
}

export function updateTeamMember(
  id: string,
  personId: string,
  input: { isLead?: boolean; allocationPct?: number | null },
) {
  return request(
    `/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(personId)}`,
    { method: "PATCH", body: input },
    "Failed to update the member",
  );
}

export function removeTeamMember(id: string, personId: string) {
  return request(
    `/teams/${encodeURIComponent(id)}/members/${encodeURIComponent(personId)}`,
    { method: "DELETE" },
    "Failed to remove the member",
  );
}
