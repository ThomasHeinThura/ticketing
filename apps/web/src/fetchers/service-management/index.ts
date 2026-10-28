import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import type { Holiday } from "@/fetchers/service-calendar";
import { HttpError, readErrorDetail } from "@/lib/http-error";
import { recordServerDate } from "@/lib/server-clock";

export const SERVICE_STATUSES = ["operational", "degraded", "outage"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];
export const SUPPORT_LEVELS = ["L1", "L2", "L3"] as const;
export type SupportLevel = (typeof SUPPORT_LEVELS)[number];
export const CHANGE_RISKS = ["low", "medium", "high"] as const;
export type ChangeRisk = (typeof CHANGE_RISKS)[number];
export const RELEASE_STATUSES = [
  "planned",
  "in_progress",
  "released",
  "cancelled",
] as const;
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number];

export type CatalogueStatus = {
  enabled: boolean;
  canManageServices: boolean;
  canManageChanges: boolean;
  canManageReleases: boolean;
};

export type ServiceSummary = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  category: string | null;
  ownerTeamId: string | null;
  ownerTeamName: string | null;
  supportLevel: SupportLevel;
  serviceCalendarId: string | null;
  calendarName: string | null;
  status: ServiceStatus;
  statusNote: string | null;
  statusChangedAt: string | null;
  incidentCount: number;
  openChangeCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ServiceLink = {
  id: string;
  kind: "documentation" | "project" | "kb_article";
  label: string | null;
  url: string | null;
  projectId: string | null;
  projectName: string | null;
  kbArticleId: string | null;
};

export type ServiceRef = { id: string; name: string; status: string };

export type ServiceDetail = ServiceSummary & {
  links: ServiceLink[];
  dependsOn: ServiceRef[];
  dependents: ServiceRef[];
  releaseChecklist: { id: string; text: string; position: number }[];
  cycleDetected: boolean;
  deletionBlockers: string[];
};

export type ServiceLinkInput =
  | { kind: "documentation"; url: string; label?: string | null }
  | { kind: "project"; projectId: string }
  | { kind: "kb_article"; kbArticleId: string };

export type ServiceInput = {
  name: string;
  description?: string | null;
  category?: string | null;
  ownerTeamId?: string | null;
  supportLevel?: SupportLevel;
  serviceCalendarId?: string | null;
  links?: ServiceLinkInput[];
  dependsOnServiceIds?: string[];
  releaseChecklist?: string[];
};

export type ServiceImpact = {
  service: ServiceRef;
  impacted: {
    serviceId: string;
    name: string;
    status: string;
    depth: number;
    viaServiceId: string;
    viaName: string;
  }[];
  customers: { id: string; name: string }[];
  cycleDetected: boolean;
  cycleServiceIds: string[];
};

export type FreezeRef = {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
};

export type ChangeView = {
  workItemKey: string;
  workItemId: string;
  title: string;
  isChange: boolean;
  /** SVC-3: the service the work item references, whatever its type. */
  service: { id: string; name: string } | null;
  /** The affected services plus their dependents, and the customers they serve. */
  impact: { services: number; customers: number };
  detail: {
    risk: ChangeRisk | null;
    windowStart: string | null;
    windowEnd: string | null;
    rollbackPlan: string | null;
    release: { id: string; name: string } | null;
    version: number;
    updatedAt: string;
  } | null;
  services: { id: string; name: string }[];
  cabRequired: boolean;
  rollbackPlanPresent: boolean;
  retrospective: boolean;
  freeze: {
    blocked: boolean;
    overridden: boolean;
    freezes: FreezeRef[];
    override: { reason: string | null; by: string | null; at: string } | null;
  };
  conflicts: { key: string; title: string; serviceIds: string[] }[];
};

export type ChangePatch = {
  risk?: ChangeRisk | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  rollbackPlan?: string | null;
  serviceIds?: string[];
  releaseId?: string | null;
  /** The change detail version being edited (1 when the change has no detail yet). */
  version: number;
};

export type Freeze = {
  id: string;
  workspaceId: string;
  name: string;
  reason: string | null;
  startsAt: string;
  endsAt: string;
  cancelledAt: string | null;
  version: number;
};

export type FreezeWrite = { freeze: Freeze; affectedChanges: number };

export type FreezeOverrideRow = {
  id: string;
  at: string;
  actorName: string | null;
  workItemKey: string | null;
  reason: string | null;
  freezeNames: string[];
};

export type CalendarChange = {
  key: string;
  title: string;
  projectId: string;
  projectName: string;
  windowStart: string;
  windowEnd: string;
  risk: ChangeRisk | null;
  stateName: string;
  stateGroup: string;
  services: { id: string; name: string }[];
  retrospective: boolean;
  frozen: boolean;
  overridden: boolean;
  conflict: boolean;
};

export type ChangeCalendar = {
  from: string;
  to: string;
  freezes: (FreezeRef & { reason: string | null })[];
  changes: CalendarChange[];
  conflicts: { changeKeys: string[]; serviceIds: string[] }[];
};

export type ReleaseSummary = {
  id: string;
  workspaceId: string;
  name: string;
  serviceId: string;
  serviceName: string;
  plannedDate: string | null;
  status: ReleaseStatus;
  publishToPortal: boolean;
  publishedAt: string | null;
  version: number;
  createdAt: string;
  changeCount: number;
  checklistTotal: number;
  checklistDone: number;
};

export type ReleaseDetail = Omit<
  ReleaseSummary,
  "changeCount" | "checklistTotal" | "checklistDone"
> & {
  notes: string | null;
  notesGeneratedAt: string | null;
  notesEditedAt: string | null;
  notesLocked: boolean;
  changes: {
    key: string;
    title: string;
    typeName: string;
    stateName: string;
    risk: ChangeRisk | null;
    windowStart: string | null;
    windowEnd: string | null;
  }[];
  hiddenChangeCount: number;
  checklist: { id: string; text: string; position: number; done: boolean }[];
};

export type HolidayPresetInfo = {
  country: string;
  name: string;
  notIncluded: string;
};
export type HolidayPresetResult = {
  datasetVersion: string;
  country: string;
  year: number;
  notIncluded: string;
  holidays: { date: string; name: string; existing: boolean }[];
  applied: boolean;
  importedCount: number;
  duplicateCount: number;
  affectedWorkItemCount: number;
  /** The calendar after a confirmed append; null for a preview. */
  calendar: { holidays: Holiday[]; version: number } | null;
};

const STEP_UP_HEADER = "X-TaskDesk-Step-Up-Token";

async function request<T>(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
  fallback = "The request failed",
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.headers ? { headers: init.headers } : {}),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  recordServerDate(response);
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, fallback),
    );
  return response.json() as Promise<T>;
}

const enc = encodeURIComponent;
const ws = (workspaceId: string) => `workspaceId=${enc(workspaceId)}`;

export function getCatalogueStatus(workspaceId: string) {
  return request<CatalogueStatus>(
    `/service-catalogue/status?${ws(workspaceId)}`,
    {},
    "Failed to load the service catalogue status",
  );
}

// Services --------------------------------------------------------------------------------------

export async function listServices(workspaceId: string, q?: string) {
  const query = `${ws(workspaceId)}${q ? `&q=${enc(q)}` : ""}`;
  const result = await request<{ data: ServiceSummary[] }>(
    `/services?${query}`,
    {},
    "Failed to load services",
  );
  return result.data;
}

export function getService(id: string) {
  return request<ServiceDetail>(
    `/services/${enc(id)}`,
    {},
    "Failed to load the service",
  );
}

export function createService(workspaceId: string, input: ServiceInput) {
  return request<ServiceDetail>(
    "/services",
    { method: "POST", body: { workspaceId, ...input } },
    "Failed to create the service",
  );
}

export function updateService(
  id: string,
  input: Partial<ServiceInput> & { version?: number },
) {
  return request<ServiceDetail>(
    `/services/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the service",
  );
}

export function setServiceStatus(
  id: string,
  input: { status: ServiceStatus; note?: string | null },
) {
  return request<ServiceDetail>(
    `/services/${enc(id)}/status`,
    { method: "POST", body: input },
    "Failed to set the service status",
  );
}

export function getServiceImpact(id: string) {
  return request<ServiceImpact>(
    `/services/${enc(id)}/impact`,
    {},
    "Failed to load the impact",
  );
}

/** Requests deletion; the service stays until the requester approves it. */
export async function requestServiceDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/services/${enc(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the service deletion",
  );
}

export function setWorkItemService(key: string, serviceId: string | null) {
  return request<{ ok: true }>(
    `/work-items/${enc(key)}/service`,
    { method: "POST", body: { serviceId } },
    "Failed to set the service",
  );
}

// Changes ---------------------------------------------------------------------------------------

export function getChange(key: string) {
  return request<ChangeView>(
    `/work-items/${enc(key)}/change`,
    {},
    "Failed to load the change detail",
  );
}

export function patchChange(key: string, input: ChangePatch) {
  return request<ChangeView>(
    `/work-items/${enc(key)}/change`,
    { method: "PATCH", body: input },
    "Failed to save the change detail",
  );
}

/** CH-4: the elevated override; `stepUpToken` is the single-use proof bound to this change and reason. */
export function overrideFreeze(
  key: string,
  reason: string,
  stepUpToken: string,
) {
  return request<ChangeView>(
    `/work-items/${enc(key)}/change/override-freeze`,
    {
      method: "POST",
      body: { reason },
      headers: { [STEP_UP_HEADER]: stepUpToken },
    },
    "Failed to override the freeze",
  );
}

export function getChangeCalendar(workspaceId: string, from: Date, to: Date) {
  return request<ChangeCalendar>(
    `/changes/calendar?${ws(workspaceId)}&from=${enc(from.toISOString())}&to=${enc(to.toISOString())}`,
    {},
    "Failed to load the change calendar",
  );
}

export async function listFreezes(
  workspaceId: string,
  includeCancelled = false,
) {
  const result = await request<{ data: Freeze[] }>(
    `/change-freezes?${ws(workspaceId)}${includeCancelled ? "&includeCancelled=true" : ""}`,
    {},
    "Failed to load change freezes",
  );
  return result.data;
}

export function createFreeze(
  workspaceId: string,
  input: {
    name: string;
    reason?: string | null;
    startsAt: string;
    endsAt: string;
  },
) {
  return request<FreezeWrite>(
    "/change-freezes",
    { method: "POST", body: { workspaceId, ...input } },
    "Failed to declare the freeze",
  );
}

export function updateFreeze(
  id: string,
  input: {
    name?: string;
    reason?: string | null;
    startsAt?: string;
    endsAt?: string;
    cancel?: true;
    version?: number;
  },
) {
  return request<FreezeWrite>(
    `/change-freezes/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the freeze",
  );
}

export async function listFreezeOverrides(workspaceId: string) {
  const result = await request<{ data: FreezeOverrideRow[] }>(
    `/change-freezes/overrides?${ws(workspaceId)}`,
    {},
    "Failed to load the override report",
  );
  return result.data;
}

// Releases --------------------------------------------------------------------------------------

export async function listReleases(workspaceId: string, serviceId?: string) {
  const result = await request<{ data: ReleaseSummary[] }>(
    `/releases?${ws(workspaceId)}${serviceId ? `&serviceId=${enc(serviceId)}` : ""}`,
    {},
    "Failed to load releases",
  );
  return result.data;
}

export function getRelease(id: string) {
  return request<ReleaseDetail>(
    `/releases/${enc(id)}`,
    {},
    "Failed to load the release",
  );
}

export function createRelease(
  workspaceId: string,
  input: {
    name: string;
    serviceId: string;
    plannedDate?: string | null;
    changeKeys?: string[];
  },
) {
  return request<ReleaseDetail>(
    "/releases",
    { method: "POST", body: { workspaceId, ...input } },
    "Failed to create the release",
  );
}

export function updateRelease(
  id: string,
  input: {
    name?: string;
    plannedDate?: string | null;
    status?: ReleaseStatus;
    changeKeys?: string[];
    publishToPortal?: boolean;
    version?: number;
  },
) {
  return request<ReleaseDetail>(
    `/releases/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the release",
  );
}

export function setReleaseNotes(
  id: string,
  input: { notes: string } | { regenerate: true },
) {
  return request<ReleaseDetail>(
    `/releases/${enc(id)}/notes`,
    { method: "POST", body: input },
    "Failed to save the release notes",
  );
}

export function toggleReleaseChecklistItem(
  id: string,
  itemId: string,
  done: boolean,
) {
  return request<{ ok: true }>(
    `/releases/${enc(id)}/checklist/${enc(itemId)}`,
    { method: "PATCH", body: { done } },
    "Failed to update the checklist",
  );
}

// Holiday presets -------------------------------------------------------------------------------

export function listHolidayPresets(calendarId: string) {
  return request<{ datasetVersion: string; presets: HolidayPresetInfo[] }>(
    `/service-calendars/${enc(calendarId)}/holidays/presets`,
    {},
    "Failed to load the holiday presets",
  );
}

export function applyHolidayPreset(
  calendarId: string,
  input: { country: string; year: number; preview: boolean },
  version?: number,
) {
  return request<HolidayPresetResult>(
    `/service-calendars/${enc(calendarId)}/holidays/preset`,
    {
      method: "POST",
      body: input,
      ...(version === undefined
        ? {}
        : { headers: { "If-Match": `"${version}"` } }),
    },
    "Failed to apply the holiday preset",
  );
}

// CAB workflow template (CH-2) --------------------------------------------------------------------

export type CabTemplateStatus = {
  applied: boolean;
  workflowId: string | null;
  approvedStateTemplateId: string | null;
  adoptedProjectIds: string[];
  changeTypeCount: number;
};

export type CabTemplateResult = {
  workflowId: string;
  versionNumber: number;
  alreadyApplied: boolean;
  approvedStateTemplateId: string;
  changeTypeIds: string[];
  adoptedProjectIds: string[];
  unadoptedProjects: Array<{ id: string; name: string }>;
};

export function getCabTemplateStatus(workspaceId: string) {
  return request<CabTemplateStatus>(
    `/change-cab-template?${ws(workspaceId)}`,
    {},
    "Failed to load the CAB template status",
  );
}

/** The 409 that names the projects whose open changes would be stranded. */
export class CabTemplateStrandedError extends HttpError {
  projects: Array<{ id: string; name: string }>;
  constructor(projects: Array<{ id: string; name: string }>) {
    super(409, "projects_would_strand_changes");
    this.projects = projects;
  }
}

export async function applyCabTemplate(
  workspaceId: string,
  projectIds: string[],
) {
  const response = await apiFetch(getApiUrl("/change-cab-template"), {
    method: "POST",
    credentials: "include",
    body: JSON.stringify({ workspaceId, projectIds }),
  });
  if (response.status === 409) {
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      message?: string;
      projects?: Array<{ id: string; name: string }>;
    } | null;
    if (body?.message === "projects_would_strand_changes")
      throw new CabTemplateStrandedError(body.projects ?? []);
  }
  if (!response.ok)
    throw new HttpError(
      response.status,
      await readErrorDetail(response, "Failed to apply the CAB template"),
    );
  return response.json() as Promise<CabTemplateResult>;
}
