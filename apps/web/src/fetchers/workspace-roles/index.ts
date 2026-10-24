import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "@/fetchers/get-api-url";
import { readPendingDeletion } from "@/fetchers/pending-action/read-pending-deletion";
import { HttpError, readErrorDetail } from "@/lib/http-error";

/**
 * Roles (RL-1..RL-15) on the canonical `role` store. A role's capabilities are the stored
 * `resource:action` names; `permission` is a deprecated statement view kept by the API for
 * pre-canonical clients and never read here.
 */
export type WorkspaceRoleDetail = {
  id: string;
  workspaceId: string;
  /** The stable key `workspace_member.role` holds. */
  role: string;
  name: string;
  description: string | null;
  rank: number;
  capabilities: string[];
  isSystem: boolean;
  isEditable: boolean;
  holderCount: number;
  /** Optimistic-concurrency token; echoed back as `expectedVersion` on save. */
  version: string;
  createdAt: string;
  updatedAt: string;
};

export type RoleHolder = {
  userId: string;
  personId: string | null;
  name: string;
  email: string;
  image: string | null;
  active: boolean;
  suspended: boolean;
  joinedAt: string;
};

export type RoleHistoryEntry = {
  id: string;
  action: string;
  actorName: string | null;
  actorType: string;
  added: string[];
  removed: string[];
  rank: { before: number | null; after: number | null } | null;
  createdAt: string;
};

export type RolePreview = {
  navigation: Preview[];
  workItemActions: Preview[];
  capabilityCount: number;
};
type Preview = {
  key: string;
  label: string;
  requires: string;
  allowed: boolean;
};

/** A refusal with the API's machine-readable code (`rank_guard`, `last_role_manager`, ...). */
export class RoleApiError extends HttpError {
  readonly code: string | null;
  readonly body: Record<string, unknown> | null;

  constructor(
    status: number,
    message: string,
    code: string | null,
    body: Record<string, unknown> | null,
  ) {
    super(status, message);
    this.name = "RoleApiError";
    this.code = code;
    this.body = body;
  }
}

/** The one-use PA-15 proof an elevated role write spends (create and update). */
const STEP_UP_HEADER = "X-TaskDesk-Step-Up-Token";

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; stepUpToken?: string } = {},
  fallback = "The request failed",
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method: init.method ?? "GET",
    credentials: "include",
    ...(init.stepUpToken
      ? { headers: { [STEP_UP_HEADER]: init.stepUpToken } }
      : {}),
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!response.ok) {
    const copy = response.clone();
    const message = await readErrorDetail(response, fallback);
    let body: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await copy.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        body = parsed as Record<string, unknown>;
    } catch {
      body = null;
    }
    throw new RoleApiError(
      response.status,
      message,
      typeof body?.error === "string" ? body.error : null,
      body,
    );
  }
  return response.json() as Promise<T>;
}

const base = (workspaceId: string) =>
  `/workspace/${encodeURIComponent(workspaceId)}/roles`;

export function listRoles(workspaceId: string) {
  return request<WorkspaceRoleDetail[]>(
    base(workspaceId),
    {},
    "Failed to load roles",
  );
}

export function getRole(workspaceId: string, roleId: string) {
  return request<WorkspaceRoleDetail>(
    `${base(workspaceId)}/${encodeURIComponent(roleId)}`,
    {},
    "Failed to load the role",
  );
}

export function getRoleHolders(workspaceId: string, roleId: string) {
  return request<{ role: WorkspaceRoleDetail; holders: RoleHolder[] }>(
    `${base(workspaceId)}/${encodeURIComponent(roleId)}/holders`,
    {},
    "Failed to load the people holding this role",
  );
}

export function getRoleHistory(workspaceId: string, roleId: string) {
  return request<RoleHistoryEntry[]>(
    `${base(workspaceId)}/${encodeURIComponent(roleId)}/history`,
    {},
    "Failed to load the role history",
  );
}

export function previewRole(
  workspaceId: string,
  roleId: string,
  capabilities: string[],
) {
  return request<RolePreview>(
    `${base(workspaceId)}/${encodeURIComponent(roleId)}/preview`,
    { method: "POST", body: { capabilities } },
    "Failed to preview the role",
  );
}

export type CreateRoleInput = {
  /** The display name; the immutable key is derived from it by the API. */
  role: string;
  description?: string | null;
  rank?: number;
  capabilities?: string[];
  cloneFromRoleId?: string;
};

export function createRole(
  workspaceId: string,
  input: CreateRoleInput,
  stepUpToken?: string,
) {
  return request<WorkspaceRoleDetail>(
    base(workspaceId),
    { method: "POST", body: input, stepUpToken },
    "Failed to create the role",
  );
}

export type UpdateRoleInput = {
  name?: string;
  description?: string | null;
  rank?: number;
  capabilities?: string[];
  expectedVersion?: string;
  confirmSelfEdit?: boolean;
};

export function updateRole(
  workspaceId: string,
  roleId: string,
  input: UpdateRoleInput,
  stepUpToken?: string,
) {
  return request<WorkspaceRoleDetail>(
    `${base(workspaceId)}/${encodeURIComponent(roleId)}`,
    { method: "PATCH", body: input, stepUpToken },
    "Failed to save the role",
  );
}

export function reassignRole(
  workspaceId: string,
  roleId: string,
  input: { toRoleId: string; userIds?: string[] },
) {
  return request<{ fromRoleId: string; toRoleId: string; moved: number }>(
    `${base(workspaceId)}/${encodeURIComponent(roleId)}/reassign`,
    { method: "POST", body: input },
    "Failed to move the people to the other role",
  );
}

/** Deletion is a pending action: nothing is removed until the requester approves it. */
export async function requestRoleDeletion(workspaceId: string, roleId: string) {
  const response = await apiFetch(
    getApiUrl(`${base(workspaceId)}/${encodeURIComponent(roleId)}`),
    { method: "DELETE", credentials: "include" },
  );
  return readPendingDeletion(response, "Failed to delete the role");
}
