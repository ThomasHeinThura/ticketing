import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/** Cycles, modules and estimates (`CY-1`..`CY-9`, `MO-1`..`MO-4`, `ES-1`..`ES-5`). */

export type ScopeUnit = "points" | "time" | "count";
export type EstimateSystem = "points" | "categories" | "time";
export type IncompletePolicy = "next_cycle" | "backlog" | "leave";
export type CycleStatus = "upcoming" | "active" | "completed";
export type ModuleState =
  | "backlog"
  | "planned"
  | "in_progress"
  | "paused"
  | "completed"
  | "cancelled";

export const MODULE_STATES: readonly ModuleState[] = [
  "backlog",
  "planned",
  "in_progress",
  "paused",
  "completed",
  "cancelled",
];
export const INCOMPLETE_POLICIES: readonly IncompletePolicy[] = [
  "next_cycle",
  "backlog",
  "leave",
];
export const ESTIMATE_SYSTEMS: readonly EstimateSystem[] = [
  "points",
  "categories",
  "time",
];

export type Bucket = { count: number; points: number };
export type CycleSummary = {
  unit: ScopeUnit;
  total: Bucket;
  completed: Bucket;
  inProgress: Bucket;
  notStarted: Bucket;
  cancelled: Bucket;
  unestimated: { count: number; share: number };
};

export type Velocity =
  | { status: "ok"; unit: ScopeUnit; value: number; cycles: number }
  | {
      status: "insufficient_data";
      cycles: number;
      reason: "fewer_than_three" | "mixed_units";
    };

export type Cycle = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: CycleStatus;
  completedAt: string | null;
  version: number;
  summary: CycleSummary;
};

export type CycleList = {
  data: Cycle[];
  meta: {
    unit: ScopeUnit;
    velocity: Velocity;
    incompletePolicy: IncompletePolicy;
    canManage: boolean;
    today: string;
  };
};

export type CycleRef = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
};

export type ScopeChange = {
  workItemKey: string;
  title: string;
  kind: "added" | "removed";
  at: string;
  retrospective: boolean;
};

export type Discontinuity = {
  date: string;
  kind: "system" | "scale";
  fromSystem: EstimateSystem | null;
  toSystem: EstimateSystem | null;
};

export type CycleDetail = Cycle & {
  scopeChanges: ScopeChange[];
  completionPreview: {
    defaultPolicy: IncompletePolicy;
    incompleteCount: number;
    nextCycle: CycleRef | null;
  };
  velocity: Velocity;
  discontinuities: Discontinuity[];
  canManage: boolean;
  canEditItems: boolean;
};

export type Burndown = {
  unit: ScopeUnit;
  noScope: boolean;
  startDate: string;
  endDate: string;
  openingScope: number;
  points: Array<{
    date: string;
    scope: number;
    completed: number;
    remaining: number;
    ideal: number;
  }>;
  unestimated: { count: number; share: number };
  discontinuities: Discontinuity[];
};

export type CompleteCycleResult = {
  dryRun: boolean;
  cycle: Cycle;
  policy: IncompletePolicy;
  destinationCycle: CycleRef | null;
  movedCount: number;
  leftCount: number;
};

export type CycleItemsResult = {
  added: string[];
  alreadyInCycle: string[];
  movedFromOtherCycle: string[];
  refused: Array<{ key: string; reason: string }>;
};

export type ModuleItemsResult = {
  added: string[];
  alreadyInModule: string[];
  movedFromOtherModule: string[];
  refused: Array<{ key: string; reason: string }>;
};

export type ModuleForecast =
  | { status: "no_target" }
  | { status: "complete" }
  | { status: "insufficient_data"; completedInWindow: number }
  | {
      status: "on_track" | "at_risk" | "late";
      earliest: string;
      latest: string;
      targetDate: string;
    };

export type ModuleRow = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  description: string | null;
  lead: { id: string; name: string | null } | null;
  state: ModuleState;
  targetDate: string | null;
  version: number;
  progress: {
    total: number;
    completed: number;
    cancelled: number;
    remaining: number;
    percent: number;
  };
  forecast: ModuleForecast;
};

export type LeadCandidate = { id: string; name: string };

export type ModuleList = {
  data: ModuleRow[];
  meta: { canManage: boolean; leadCandidates: LeadCandidate[] };
};

export type ModuleDetail = ModuleRow & {
  canManage: boolean;
  canEditItems: boolean;
  leadCandidates: LeadCandidate[];
};

export type EstimatePoint = {
  id: string;
  key: string;
  value: string;
  weight: number | null;
  position: number;
};

export type Estimate = {
  system: EstimateSystem | null;
  estimateId: string | null;
  points: EstimatePoint[];
  defaults: { points: string[]; categories: string[]; time: string[] };
  incompletePolicy: IncompletePolicy;
  canManage: boolean;
};

export type EstimatePreview = {
  fromSystem: EstimateSystem | null;
  toSystem: EstimateSystem;
  mapping: Array<{
    fromPointId: string;
    fromValue: string;
    toKey: string | null;
    toValue: string | null;
    itemCount: number;
  }>;
  mappedItems: number;
  clearedItems: number;
  activeCycles: Array<{ id: string; name: string }>;
};

export type UpdateEstimatesInput = {
  system?: EstimateSystem;
  points?: Array<{ key?: string; value: string }>;
  dryRun?: boolean;
  confirmClear?: boolean;
};

export type UpdateEstimatesResult = {
  applied: boolean;
  preview: EstimatePreview;
  estimate: Estimate;
};

export type WorkItemEstimate = {
  estimatePointId: string | null;
  point: EstimatePoint | null;
  rollup: {
    own: number | null;
    rollup: number | null;
    effective: number | null;
    discrepancy: boolean;
  };
};

export type CreateCycleInput = {
  name: string;
  startDate: string;
  endDate: string;
};
export type UpdateCycleInput = Partial<CreateCycleInput> & {
  version: number;
};
export type ModuleInput = {
  name: string;
  description?: string | null;
  leadId?: string | null;
  state?: ModuleState;
  targetDate?: string | null;
};

/** `409 cycle_overlap`: names the cycle the dates collide with (`CY-2`). */
export class CycleOverlapError extends HttpError {
  conflictingCycle: CycleRef;
  constructor(conflictingCycle: CycleRef) {
    super(409, "cycle_overlap");
    this.name = "CycleOverlapError";
    this.conflictingCycle = conflictingCycle;
  }
}

/** `409 estimate_change_requires_confirmation`: carries what would be cleared (`ES-3`). */
export class EstimateConfirmationError extends HttpError {
  preview: EstimatePreview;
  constructor(preview: EstimatePreview) {
    super(409, "estimate_change_requires_confirmation");
    this.name = "EstimateConfirmationError";
    this.preview = preview;
  }
}

/** The feature is off for the project: the API hides cycles, modules and estimates (404). */
export class FeatureDisabledError extends HttpError {
  constructor() {
    super(404, "feature_disabled");
    this.name = "FeatureDisabledError";
  }
}

async function failure(response: Response, fallback: string): Promise<never> {
  if (response.status === 404 || response.status === 409) {
    let body: Record<string, unknown> | null = null;
    try {
      body = (await response.clone().json()) as Record<string, unknown>;
    } catch {
      body = null;
    }
    if (body?.message === "feature_disabled") throw new FeatureDisabledError();
    if (body?.message === "cycle_overlap" && body.conflictingCycle)
      throw new CycleOverlapError(body.conflictingCycle as CycleRef);
    if (
      body?.message === "estimate_change_requires_confirmation" &&
      body.preview
    )
      throw new EstimateConfirmationError(body.preview as EstimatePreview);
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

// Cycles ---------------------------------------------------------------------------------------

export const getCycles = (projectKey: string) =>
  request<CycleList>(
    `/projects/${enc(projectKey)}/cycles`,
    {},
    "Failed to load cycles",
  );

export const createCycle = (projectKey: string, input: CreateCycleInput) =>
  request<Cycle>(
    `/projects/${enc(projectKey)}/cycles`,
    { method: "POST", body: input },
    "Failed to create the cycle",
  );

export const getCycle = (id: string) =>
  request<CycleDetail>(`/cycles/${enc(id)}`, {}, "Failed to load the cycle");

export const updateCycle = (id: string, input: UpdateCycleInput) =>
  request<Cycle>(
    `/cycles/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the cycle",
  );

export async function requestCycleDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/cycles/${enc(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the cycle deletion",
  );
}

export const completeCycle = (
  id: string,
  input: { incompletePolicy?: IncompletePolicy; dryRun?: boolean },
) =>
  request<CompleteCycleResult>(
    `/cycles/${enc(id)}/complete`,
    { method: "POST", body: input },
    "Failed to complete the cycle",
  );

export const getBurndown = (id: string) =>
  request<Burndown>(
    `/cycles/${enc(id)}/burndown`,
    {},
    "Failed to load the burndown",
  );

export const addCycleWorkItems = (id: string, workItemKeys: string[]) =>
  request<CycleItemsResult>(
    `/cycles/${enc(id)}/work-items`,
    { method: "POST", body: { workItemKeys } },
    "Failed to add the work items",
  );

export const removeCycleWorkItem = (id: string, workItemKey: string) =>
  request<unknown>(
    `/cycles/${enc(id)}/work-items/${enc(workItemKey)}`,
    { method: "DELETE" },
    "Failed to remove the work item",
  );

// Modules --------------------------------------------------------------------------------------

export const getModules = (projectKey: string) =>
  request<ModuleList>(
    `/projects/${enc(projectKey)}/modules`,
    {},
    "Failed to load modules",
  );

export const createModule = (projectKey: string, input: ModuleInput) =>
  request<ModuleRow>(
    `/projects/${enc(projectKey)}/modules`,
    { method: "POST", body: input },
    "Failed to create the module",
  );

export const getModule = (id: string) =>
  request<ModuleDetail>(`/modules/${enc(id)}`, {}, "Failed to load the module");

export const updateModule = (
  id: string,
  input: Partial<ModuleInput> & { version: number },
) =>
  request<ModuleRow>(
    `/modules/${enc(id)}`,
    { method: "PATCH", body: input },
    "Failed to save the module",
  );

export async function requestModuleDeletion(id: string) {
  return readPendingDeletion(
    await apiFetch(getApiUrl(`/modules/${enc(id)}`), {
      method: "DELETE",
      credentials: "include",
    }),
    "Failed to request the module deletion",
  );
}

export const addModuleWorkItems = (id: string, workItemKeys: string[]) =>
  request<ModuleItemsResult>(
    `/modules/${enc(id)}/work-items`,
    { method: "POST", body: { workItemKeys } },
    "Failed to add the work items",
  );

export const removeModuleWorkItem = (id: string, workItemKey: string) =>
  request<unknown>(
    `/modules/${enc(id)}/work-items/${enc(workItemKey)}`,
    { method: "DELETE" },
    "Failed to remove the work item",
  );

// Estimates and settings -----------------------------------------------------------------------

export const getEstimates = (projectKey: string) =>
  request<Estimate>(
    `/projects/${enc(projectKey)}/estimates`,
    {},
    "Failed to load the estimate settings",
  );

export const updateEstimates = (
  projectKey: string,
  input: UpdateEstimatesInput,
) =>
  request<UpdateEstimatesResult>(
    `/projects/${enc(projectKey)}/estimates`,
    { method: "PATCH", body: input },
    "Failed to save the estimate settings",
  );

export const getAgileSettings = (projectKey: string) =>
  request<{ incompletePolicy: IncompletePolicy; version: number }>(
    `/projects/${enc(projectKey)}/agile-settings`,
    {},
    "Failed to load the cycle settings",
  );

export const updateAgileSettings = (
  projectKey: string,
  input: { incompletePolicy: IncompletePolicy; version?: number },
) =>
  request<{ incompletePolicy: IncompletePolicy; version: number }>(
    `/projects/${enc(projectKey)}/agile-settings`,
    { method: "PATCH", body: input },
    "Failed to save the cycle settings",
  );

// A single work item ---------------------------------------------------------------------------

export const getWorkItemEstimate = (key: string) =>
  request<WorkItemEstimate>(
    `/work-items/${enc(key)}/estimate`,
    {},
    "Failed to load the estimate",
  );

export const setWorkItemEstimate = (
  key: string,
  estimatePointId: string | null,
) =>
  request<WorkItemEstimate>(
    `/work-items/${enc(key)}/estimate`,
    { method: "PUT", body: { estimatePointId } },
    "Failed to save the estimate",
  );

export const setWorkItemCycle = (key: string, cycleId: string | null) =>
  request<{ cycleId: string | null; cycleName: string | null }>(
    `/work-items/${enc(key)}/cycle`,
    { method: "PUT", body: { cycleId } },
    "Failed to save the cycle",
  );

export const setWorkItemModule = (key: string, moduleId: string | null) =>
  request<{ moduleId: string | null; moduleName: string | null }>(
    `/work-items/${enc(key)}/module`,
    { method: "PUT", body: { moduleId } },
    "Failed to save the module",
  );

// Resolved feature flags -----------------------------------------------------------------------

export type ResolvedFeature = { key: string; enabled: boolean };

/** `GET /api/features/resolved?project=` — the project, workspace, instance, default order (ST-1). */
export async function getResolvedFeatures(
  projectId: string,
): Promise<ResolvedFeature[]> {
  const result = await request<{ features: ResolvedFeature[] }>(
    `/features/resolved?project=${enc(projectId)}`,
    {},
    "Failed to load the feature switches",
  );
  return result.features;
}

// Board WIP limits (VW-12) and timeline dependencies (VW-28) -----------------------------------

export type WipLimits = {
  data: Array<{ stateId: string; limit: number }>;
  canManage: boolean;
};

export const getWipLimits = (projectKey: string) =>
  request<WipLimits>(
    `/projects/${enc(projectKey)}/wip-limits`,
    {},
    "Failed to load the column limits",
  );

export const setWipLimit = (
  projectKey: string,
  stateId: string,
  limit: number | null,
) =>
  request<{ stateId: string; limit: number | null }>(
    `/projects/${enc(projectKey)}/wip-limits/${enc(stateId)}`,
    { method: "PUT", body: { limit } },
    "Failed to save the column limit",
  );

export type DependencyType = "blocks" | "precedes";
export type DependencyEdge = {
  id: string;
  type: DependencyType;
  sourceKey: string;
  targetKey: string;
};

export const getDependencies = async (
  projectKey: string,
  types: readonly DependencyType[] = ["blocks", "precedes"],
) =>
  (
    await request<{ data: DependencyEdge[] }>(
      `/projects/${enc(projectKey)}/dependencies?types=${types.join(",")}`,
      {},
      "Failed to load the dependencies",
    )
  ).data;
