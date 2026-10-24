import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export type HealthState = "ok" | "degraded" | "failing" | "unknown";

export type HealthCheck = {
  key: string;
  state: HealthState;
  detail: Record<string, number | boolean | null>;
};

export type InstanceHealth = {
  checkedAt: string;
  state: HealthState;
  checks: HealthCheck[];
};

export async function getInstanceHealth(): Promise<InstanceHealth> {
  const response = await apiFetch(getApiUrl("instance/health"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "Instance health request failed");
  return (await response.json()) as InstanceHealth;
}

export type SecretsRotationAccepted = {
  status: "accepted";
  progress: {
    complete: boolean;
    pending: {
      plugins: number;
      identityConnections: number;
      textSecrets: number;
    };
  };
};

/**
 * GM-13: starts the leased, resumable `secrets-rekey` job. Elevated and session-only: the
 * single-use step-up token is bound to this operation, and the response carries counts only.
 */
export async function startSecretsRotation(
  token: string,
): Promise<SecretsRotationAccepted> {
  const response = await apiFetch(
    getApiUrl("instance/plugins/rotate-secrets"),
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-TaskDesk-Step-Up-Token": token,
      },
      body: "{}",
    },
  );
  if (!response.ok)
    throw new HttpError(
      response.status,
      "Secret rotation could not be started",
    );
  return (await response.json()) as SecretsRotationAccepted;
}
