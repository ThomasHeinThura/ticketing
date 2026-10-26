import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export type InstanceJobRun = {
  id: string;
  trigger: "scheduled" | "manual";
  state: "queued" | "running" | "succeeded" | "failed" | "lease_lost";
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorCode: "handler_failed" | "authorization_lost" | "lease_lost" | null;
};

export type InstanceJob = {
  name: string;
  pattern: string | null;
  defaultPattern: string | null;
  timezone: string | null;
  enabled: boolean;
  version: number;
  nextRunAt: string | null;
  manualRunAllowed: boolean;
  lastRun: InstanceJobRun | null;
  queuedRun: InstanceJobRun | null;
};

export type InstanceJobs = { checkedAt: string; jobs: InstanceJob[] };

export async function listInstanceJobs(): Promise<InstanceJobs> {
  const response = await apiFetch(getApiUrl("instance/jobs"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "Instance jobs request failed");
  return (await response.json()) as InstanceJobs;
}

export async function updateInstanceJob(
  name: string,
  input: {
    expectedVersion: number;
    pattern?: string | null;
    enabled?: boolean;
  },
): Promise<{ job: InstanceJob }> {
  const response = await apiFetch(
    getApiUrl(`instance/jobs/${encodeURIComponent(name)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok)
    throw new HttpError(response.status, "Job configuration update failed");
  return (await response.json()) as { job: InstanceJob };
}

export async function queueInstanceJobRun(
  name: string,
): Promise<{ run: { id: string; state: "queued" } }> {
  const response = await apiFetch(
    getApiUrl(`instance/jobs/${encodeURIComponent(name)}/run`),
    { method: "POST", credentials: "include" },
  );
  if (!response.ok)
    throw new HttpError(response.status, "Job run could not be queued");
  return (await response.json()) as { run: { id: string; state: "queued" } };
}
