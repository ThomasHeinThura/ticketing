import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "./get-api-url";

export type WorkspaceProjectSettings = {
  workspaceId: string;
  defaultSlaPolicyId: string | null;
  defaultServiceCalendarId: string | null;
  enabledStateTemplateIds: string[];
  version: number;
};

export type WorkspaceStateTemplate = {
  id: string;
  key: string;
  name: string;
  group: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  enabled: boolean;
};

export type WorkspaceStateTemplates = {
  workspaceId: string;
  version: number;
  templates: WorkspaceStateTemplate[];
};

export type AffectedStateItem = {
  id: string;
  key: string;
  title: string;
  projectId: string;
  projectName: string;
};

export class WorkspaceSettingsError extends HttpError {
  readonly code: string | undefined;
  readonly affectedItems: AffectedStateItem[];
  readonly hasHiddenAffectedItems: boolean;

  constructor(
    status: number,
    message: string,
    options?: {
      code?: string;
      affectedItems?: AffectedStateItem[];
      hasHiddenAffectedItems?: boolean;
    },
  ) {
    super(status, message);
    this.name = "WorkspaceSettingsError";
    this.code = options?.code;
    this.affectedItems = options?.affectedItems ?? [];
    this.hasHiddenAffectedItems = options?.hasHiddenAffectedItems === true;
  }
}

export type SettingMode = "inherit" | "override";
export type ProjectSettingValue = {
  mode: SettingMode;
  /** The local override only. `null` is an explicit override to no value. */
  overrideId: string | null;
  effectiveId: string | null;
  effectiveName: string | null;
  source: "project" | "workspace" | "none";
};

export type ProjectSettingsInheritance = {
  projectId: string;
  workspaceId: string;
  projectVersion: number;
  workspaceVersion: number;
  slaPolicy: ProjectSettingValue;
  serviceCalendar: ProjectSettingValue;
  states: {
    mode: SettingMode;
    activeTemplateIds: string[];
    workspaceTemplateIds: string[];
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
      code?: string;
      affectedItems?: AffectedStateItem[];
      hasHiddenAffectedItems?: boolean;
    } | null;
    throw new WorkspaceSettingsError(
      response.status,
      body?.message ?? "Workspace settings request failed",
      {
        code: body?.code,
        affectedItems: body?.affectedItems,
        hasHiddenAffectedItems: body?.hasHiddenAffectedItems,
      },
    );
  }
  return (await response.json()) as T;
}

const workspacePath = (workspaceId: string) =>
  `workspace/${encodeURIComponent(workspaceId)}`;

export function getWorkspaceProjectSettings(workspaceId: string) {
  return request<WorkspaceProjectSettings>(
    `${workspacePath(workspaceId)}/project-settings`,
  );
}

export function patchWorkspaceProjectSettings(
  workspaceId: string,
  patch: {
    expectedVersion: number;
    defaultSlaPolicyId?: string | null;
    defaultServiceCalendarId?: string | null;
  },
) {
  return request<WorkspaceProjectSettings>(
    `${workspacePath(workspaceId)}/project-settings`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export function getWorkspaceStateTemplates(workspaceId: string) {
  return request<WorkspaceStateTemplates>(
    `${workspacePath(workspaceId)}/state-templates`,
  );
}

export function createWorkspaceStateTemplate(
  workspaceId: string,
  body: {
    expectedVersion: number;
    key: string;
    name: string;
    group: WorkspaceStateTemplate["group"];
  },
): Promise<WorkspaceStateTemplate> {
  return request<WorkspaceStateTemplate>(
    `${workspacePath(workspaceId)}/state-templates`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export function patchWorkspaceStateTemplate(
  workspaceId: string,
  stateTemplateId: string,
  body: {
    expectedVersion: number;
    name?: string;
    group?: WorkspaceStateTemplate["group"];
    enabled?: boolean;
  },
): Promise<WorkspaceStateTemplate> {
  return request<WorkspaceStateTemplate>(
    `${workspacePath(workspaceId)}/state-templates/${encodeURIComponent(stateTemplateId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

export function getProjectSettingsInheritance(projectId: string) {
  return request<ProjectSettingsInheritance>(
    `projects/${encodeURIComponent(projectId)}/settings/inheritance`,
  );
}

export function patchProjectSettingsInheritance(
  projectId: string,
  patch: {
    expectedProjectVersion: number;
    expectedWorkspaceVersion: number;
    slaPolicy?: { mode: "inherit" } | { mode: "override"; id: string | null };
    serviceCalendar?:
      | { mode: "inherit" }
      | { mode: "override"; id: string | null };
  },
) {
  return request<ProjectSettingsInheritance>(
    `projects/${encodeURIComponent(projectId)}/settings/inheritance`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
}

export function inheritProjectStateSet(input: {
  projectId: string;
  expectedProjectVersion: number;
  expectedWorkspaceVersion: number;
}) {
  return request<ProjectSettingsInheritance>(
    `projects/${encodeURIComponent(input.projectId)}/state-set`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedProjectVersion: input.expectedProjectVersion,
        expectedWorkspaceVersion: input.expectedWorkspaceVersion,
        mode: "inherit",
      }),
    },
  );
}
