import { apiFetch } from "@taskdesk/libs";
import { getApiUrl } from "../get-api-url";
import { ensureIdentityAdminOk } from "./identity-admin-error";
import type { StorageProbeResult } from "./storage-usage";

export type S3DraftConfig = {
  connector: "external" | "bundled_seaweedfs";
  endpoint?: string;
  publicBaseUrl: string;
  region: string;
  bucket: string;
  keyPrefix: string;
  forcePathStyle: boolean;
  maxImageUploadBytes: number;
  presignTtlSeconds: number;
};
export type S3DraftRequest = {
  version: number;
  config: S3DraftConfig;
  credentials?: {
    accessKeyId?: string | null;
    secretAccessKey?: string | null;
  } | null;
};
export type S3DraftResponse = {
  version: number;
  config: S3DraftConfig | null;
  credentialConfigured: boolean;
  accessKeyIdConfigured: boolean;
  secretAccessKeyConfigured: boolean;
};
export type S3DraftProbe = StorageProbeResult & { browserPathVerified: false };

async function request<T>(
  path: string,
  method: "GET" | "PUT" | "POST",
  body?: S3DraftRequest,
  token?: string,
): Promise<T> {
  const response = await apiFetch(getApiUrl(path), {
    method,
    credentials: "include",
    cache: "no-store",
    ...(body
      ? {
          headers: {
            "Content-Type": "application/json",
            "x-taskdesk-step-up-token": token ?? "",
          },
          body: JSON.stringify(body),
        }
      : {}),
  });
  await ensureIdentityAdminOk(response, "Storage draft request failed");
  return (await response.json()) as T;
}
export const getS3Draft = () =>
  request<S3DraftResponse>("instance/storage/s3-draft", "GET");
export const saveS3Draft = (body: S3DraftRequest, token: string) =>
  request<S3DraftResponse>("instance/storage/s3-draft", "PUT", body, token);
export const testS3Draft = (body: S3DraftRequest, token: string) =>
  request<S3DraftProbe>("instance/storage/s3-draft/test", "POST", body, token);
