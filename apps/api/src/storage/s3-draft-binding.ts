import { createHmac } from "node:crypto";
import { resolveAuthSecret } from "../utils/require-auth-secret";
import { type S3DraftWrite, s3DraftWriteSchema } from "./s3-draft-schema";

export const STORAGE_CONFIG_SAVE_OPERATION = "storage_config_save" as const;
export const STORAGE_CONFIG_SAVE_ROUTE =
  "PUT /api/instance/storage/s3-draft" as const;
export const STORAGE_CONFIG_TEST_OPERATION = "storage_config_test" as const;
export const STORAGE_CONFIG_TEST_ROUTE =
  "POST /api/instance/storage/s3-draft/test" as const;

/** Server-derived only. Neither credentials nor their binding digests enter audit logs. */
export function canonicalS3DraftRequest(input: S3DraftWrite) {
  const request = s3DraftWriteSchema.parse({
    version: input.version,
    config: input.config,
    credentials: input.credentials,
  });
  const secret = resolveAuthSecret(process.env.TASKDESK_AUTH_SECRET);
  if (!secret.ok)
    throw new Error("Storage configuration verification unavailable");
  const credentialIntent = (field: "accessKeyId" | "secretAccessKey") => {
    const value =
      request.credentials === null ? null : request.credentials?.[field];
    if (value === undefined) return { intent: "keep" as const };
    if (value === null) return { intent: "clear" as const };
    return {
      intent: "replace" as const,
      digest: createHmac("sha256", secret.secret)
        .update("taskdesk:storage-draft:credential:v1\0")
        .update(field)
        .update("\0")
        .update(value)
        .digest("hex"),
    };
  };
  return {
    // The PA-15 envelope remains version 1; this exact CAS version is in its hashed body.
    draftVersion: request.version,
    config: request.config,
    credentials: {
      accessKeyId: credentialIntent("accessKeyId"),
      secretAccessKey: credentialIntent("secretAccessKey"),
    },
  };
}
