import { apiFetch } from "@taskdesk/libs";
import { HttpError } from "@/lib/http-error";
import { getApiUrl } from "../get-api-url";

export type StorageUsage = {
  checkedAt: string;
  backend: {
    source: "bootstrap";
    driver: "filesystem" | "s3" | "unsupported";
    configuration: "configured" | "incomplete" | "unavailable" | "unsupported";
    connectivity: "not_checked";
    probeAvailable: boolean;
  };
  usageBasis: "attachment_metadata";
  physicalUsageAvailable: false;
  limits: {
    maxAttachmentBytes: number;
    maxAttachmentsPerItem: number;
    allowedExtensions: string[];
  };
  attachments: Record<
    "ready" | "pending" | "deleted",
    { count: number; bytes: string }
  >;
};

export type StorageProbeResult = {
  status:
    | "verified"
    | "write_failed"
    | "read_failed"
    | "content_mismatch"
    | "timed_out"
    | "cleanup_failed"
    | "cleanup_indeterminate";
  cleanup: "confirmed" | "failed" | "indeterminate" | "not_attempted";
  durationMs: number;
};

export async function getStorageUsage(): Promise<StorageUsage> {
  const response = await apiFetch(getApiUrl("instance/storage/usage"), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "Storage usage request failed");
  return (await response.json()) as StorageUsage;
}

export async function runStorageProbe(): Promise<StorageProbeResult> {
  const response = await apiFetch(getApiUrl("instance/storage/test"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  if (!response.ok)
    throw new HttpError(response.status, "Storage probe request failed");
  return (await response.json()) as StorageProbeResult;
}
