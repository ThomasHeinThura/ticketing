import { isIP } from "node:net";
import { z } from "../openapi";
import {
  DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
  DEFAULT_UPLOAD_URL_TTL_SECONDS,
} from "./shared";

// DNS and socket addresses are checked separately at probe time.
const publicHttpsOrigin = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      if (value.trim() !== value || !/^https:\/\/[^/?#@\\]+\/?$/iu.test(value))
        return false;
      const url = new URL(value);
      const hostname = url.hostname;
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        !isIP(hostname.replace(/^\[|\]$/gu, "")) &&
        hostname.length <= 253 &&
        hostname.includes(".") &&
        !hostname.endsWith(".") &&
        hostname
          .split(".")
          .every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/u.test(label)) &&
        !hostname.endsWith(".internal") &&
        !hostname.endsWith(".local") &&
        !hostname.endsWith(".localhost")
      );
    } catch {
      return false;
    }
  }, "Expected a public HTTPS origin")
  .transform((value) => new URL(value).origin);

const commonConfig = {
  publicBaseUrl: publicHttpsOrigin,
  region: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9-]+$/u),
  bucket: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/u),
  keyPrefix: z
    .string()
    .max(1024)
    .refine((value) =>
      [...value].every((character) => {
        const code = character.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      }),
    ),
  maxImageUploadBytes: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_MAX_IMAGE_UPLOAD_BYTES),
  presignTtlSeconds: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_UPLOAD_URL_TTL_SECONDS),
};

export const BUNDLED_SEAWEEDFS_ENDPOINT = "http://seaweedfs:8333";
export const s3DraftConfigSchema = z.discriminatedUnion("connector", [
  z
    .object({
      connector: z.literal("external"),
      endpoint: publicHttpsOrigin,
      forcePathStyle: z.boolean(),
      ...commonConfig,
    })
    .strict(),
  z
    .object({
      connector: z.literal("bundled_seaweedfs"),
      forcePathStyle: z.literal(true),
      ...commonConfig,
    })
    .strict(),
]);

export function resolveS3DraftEndpoint(config: S3DraftConfig): string {
  return config.connector === "external"
    ? config.endpoint
    : BUNDLED_SEAWEEDFS_ENDPOINT;
}

/**
 * A stored key may only be sent to the destination an administrator approved
 * with it. The probe also targets `${bucket}.${host}` without path style.
 */
export function s3DraftDestinationChanged(
  previous: S3DraftConfig,
  next: S3DraftConfig,
): boolean {
  return (
    previous.connector !== next.connector ||
    resolveS3DraftEndpoint(previous) !== resolveS3DraftEndpoint(next) ||
    previous.forcePathStyle !== next.forcePathStyle ||
    previous.bucket !== next.bucket
  );
}

export const s3DraftCredentialsSchema = z
  .object({
    accessKeyId: z.string().min(1).max(2048),
    secretAccessKey: z.string().min(1).max(2048),
  })
  .strict()
  .refine(
    (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 16_384,
  );

export const s3DraftCredentialChangesSchema = z
  .object({
    accessKeyId: z.string().min(1).max(2048).nullable().optional(),
    secretAccessKey: z.string().min(1).max(2048).nullable().optional(),
  })
  .strict();

export const s3DraftStoredCredentialsSchema = z
  .object({
    accessKeyId: z.string().min(1).max(2048).optional(),
    secretAccessKey: z.string().min(1).max(2048).optional(),
  })
  .strict();

export const s3DraftWriteSchema = z
  .object({
    version: z.number().int().min(0).max(2_147_483_646),
    config: s3DraftConfigSchema,
    credentials: s3DraftCredentialChangesSchema.nullable().optional(),
  })
  .strict();

export const s3DraftProbeCandidateSchema = s3DraftWriteSchema;

export type S3DraftConfig = z.infer<typeof s3DraftConfigSchema>;
export type S3DraftCredentials = z.infer<typeof s3DraftCredentialsSchema>;
export type S3DraftCredentialChanges = z.infer<
  typeof s3DraftCredentialChangesSchema
>;
export type S3DraftStoredCredentials = z.infer<
  typeof s3DraftStoredCredentialsSchema
>;
export type S3DraftWrite = z.infer<typeof s3DraftWriteSchema>;
export type S3DraftProbeCandidate = z.infer<typeof s3DraftProbeCandidateSchema>;
