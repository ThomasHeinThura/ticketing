import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "./get-api-url";

/** The closed flag keys; kept in step with `packages/permissions/src/features.ts`. */
export type FeatureKey = `feature.${string}`;

export type FeatureActor = { id: string; name: string | null } | null;

export type FeatureRow = {
  key: FeatureKey;
  enabled: boolean;
  source: "project" | "workspace" | "instance" | "default";
  locked: boolean;
  defaultEnabled: boolean;
  version: number;
  updatedAt: string | null;
  updatedBy: FeatureActor;
  /** Workspace and project levels only: this level's own override, null when inherited. */
  override?: boolean | null;
  inherited?: {
    enabled: boolean;
    source: "workspace" | "instance" | "default";
  };
};

export type FeatureLevel =
  | { level: "instance" }
  | { level: "workspace"; workspaceId: string }
  | { level: "project"; projectId: string };

export type FeatureChange = {
  key: FeatureKey;
  enabled?: boolean | null;
  locked?: boolean;
  expectedVersion?: number;
};

/** `409` from a write: a locked flag (`ST-2`) or a concurrent edit. */
export class FeatureConflictError extends HttpError {
  readonly code: "feature_locked" | "version_conflict";
  constructor(code: "feature_locked" | "version_conflict") {
    super(409, code);
    this.code = code;
  }
}

function path(target: FeatureLevel) {
  switch (target.level) {
    case "instance":
      return "instance/features";
    case "workspace":
      return `workspaces/${encodeURIComponent(target.workspaceId)}/features`;
    case "project":
      return `projects/${encodeURIComponent(target.projectId)}/features`;
  }
}

async function request(target: FeatureLevel, init?: RequestInit) {
  const response = await apiFetch(getApiUrl(path(target)), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new FeatureConflictError(
      body.message === "feature_locked" ? "feature_locked" : "version_conflict",
    );
  }
  if (!response.ok)
    throw new HttpError(response.status, "Feature flag request failed");
  return (await response.json()) as { features: FeatureRow[] };
}

export async function getFeatures(target: FeatureLevel) {
  return (await request(target)).features;
}

export async function patchFeatures(
  target: FeatureLevel,
  changes: FeatureChange[],
) {
  return (
    await request(target, {
      method: "PATCH",
      body: JSON.stringify({ changes }),
    })
  ).features;
}

export type ResolvedFeatureValue = { key: FeatureKey; enabled: boolean };

/**
 * The effective on/off value of every flag for a workspace, open to any workspace reader. This is
 * what navigation reads; the list above needs `workspace:manage_settings`.
 */
export async function getWorkspaceResolvedFeatures(workspaceId: string) {
  const response = await apiFetch(
    getApiUrl(
      `workspaces/${encodeURIComponent(workspaceId)}/features/resolved`,
    ),
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok)
    throw new HttpError(response.status, "Feature flag request failed");
  return ((await response.json()) as { features: ResolvedFeatureValue[] })
    .features;
}

/** The customer portal for the signed-in customer's organisation (P4R2-M2). */
export type PortalFeatureState = "on" | "off" | "unavailable";

export async function getPortalFeatureState(): Promise<PortalFeatureState> {
  const response = await apiFetch(getApiUrl("portal/feature-state"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "Portal state request failed");
  return ((await response.json()) as { state: PortalFeatureState }).state;
}
