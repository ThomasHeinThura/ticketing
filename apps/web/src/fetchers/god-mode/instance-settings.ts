import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export type InstanceSettings = {
  approvalDefaultExpiryDays: number;
  clarificationWindowDays: number;
  reopenWindowDays: number;
  notificationRetentionDays: number;
  cspMode: "report_only" | "enforce";
  invitationLifetimeHours: number;
  customerInvitationCreateWindowMinutes: number;
  customerInvitationPerInviterLimit: number;
  customerInvitationPerOrganisationLimit: number;
  customerInvitationResendCooldownSeconds: number;
  anonymousRateLimitWindowMs: number;
  anonymousRateLimitMax: number;
  mcpWriteCeilingPerMinute: number;
  apiKeyBurstThreshold: number;
  timezone: string;
  attachmentMaxBytes: number;
  attachmentMaxPerItem: number;
  attachmentAllowedExtensions: string[];
};

export type InstanceSettingsResponse = {
  updatedAt: string;
  settings: InstanceSettings;
};

/** `409`: another administrator saved first; the page reloads the current values. */
export class InstanceSettingsConflictError extends HttpError {
  constructor() {
    super(409, "version_conflict");
  }
}

async function request(init?: RequestInit): Promise<InstanceSettingsResponse> {
  const response = await apiFetch(getApiUrl("instance/settings"), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (response.status === 409) throw new InstanceSettingsConflictError();
  if (!response.ok)
    throw new HttpError(response.status, "Instance settings request failed");
  return (await response.json()) as InstanceSettingsResponse;
}

export function getInstanceSettings() {
  return request();
}

export function patchInstanceSettings(input: {
  expectedUpdatedAt: string;
  changes: Partial<InstanceSettings>;
}) {
  return request({ method: "PATCH", body: JSON.stringify(input) });
}
