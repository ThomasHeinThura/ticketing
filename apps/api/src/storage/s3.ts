import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "dotenv-mono";
import {
  type AssetObject,
  applyKeyPrefix,
  buildAttachmentContentDisposition,
  buildObjectKey,
  buildObjectKeyPrefix,
  DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
  DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
  DEFAULT_UPLOAD_URL_TTL_SECONDS,
  getFileExtension,
  isImageContentType,
  matchesKeyContext,
  parseBoolean,
  parsePositiveInt,
  sanitizePathSegment,
  type TaskImageUploadContext,
  type TaskImageUploadUrl,
  validateUploadInput,
} from "./shared";

config();

// Re-exported verbatim so every existing caller of this module (and
// tests/api/storage/s3.test.ts, which imports these by name) keeps working unchanged. The
// implementations now live in ./shared, shared with the filesystem driver.
export {
  applyKeyPrefix,
  buildObjectKey,
  buildObjectKeyPrefix,
  getFileExtension,
  isImageContentType,
  parseBoolean,
  parsePositiveInt,
  sanitizePathSegment,
};

const DEFAULT_PRESIGN_TTL_SECONDS = DEFAULT_UPLOAD_URL_TTL_SECONDS;

type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  keyPrefix: string;
  forcePathStyle: boolean;
  maxImageUploadBytes: number;
  presignTtlSeconds: number;
};

let clientCache:
  | {
      cacheKey: string;
      client: S3Client;
    }
  | undefined;

function env(name: string) {
  return process.env[name]?.trim() || "";
}

/**
 * Resolves static S3 credentials from the access key pair.
 *
 * Returns the explicit credentials only when BOTH the access key id and secret
 * are provided. When neither is set, returns `undefined` so the AWS SDK falls
 * back to its default credential provider chain (EC2 instance profile, ECS task
 * role, EKS IRSA, environment variables, or shared config), enabling
 * IAM-role-based access without static keys.
 *
 * Throws when exactly one of the two is set, since that is almost always a
 * misconfiguration rather than an intentional fallback.
 */
export function resolveS3Credentials(
  accessKeyId: string,
  secretAccessKey: string,
): { accessKeyId: string; secretAccessKey: string } | undefined {
  const hasAccessKeyId = Boolean(accessKeyId);
  const hasSecretAccessKey = Boolean(secretAccessKey);

  if (hasAccessKeyId !== hasSecretAccessKey) {
    throw new Error(
      "Incomplete S3 credentials. Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the default AWS credential provider chain (IAM role / IRSA / environment).",
    );
  }

  if (hasAccessKeyId && hasSecretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }

  return undefined;
}

function getStorageConfig(): StorageConfig {
  const endpoint = env("S3_ENDPOINT");
  const bucket = env("S3_BUCKET");
  const accessKeyId = env("S3_ACCESS_KEY_ID");
  const secretAccessKey = env("S3_SECRET_ACCESS_KEY");

  if (!endpoint || !bucket) {
    throw new Error(
      "S3 uploads are not configured. Set S3_ENDPOINT and S3_BUCKET (and either both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the default AWS credential provider chain / IAM role).",
    );
  }

  // Validate the access key pair early so misconfiguration surfaces here rather
  // than as an opaque signing error later.
  resolveS3Credentials(accessKeyId, secretAccessKey);

  return {
    endpoint,
    region: env("S3_REGION") || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: env("S3_PUBLIC_BASE_URL") || undefined,
    keyPrefix: env("S3_KEY_PREFIX"),
    forcePathStyle: parseBoolean(process.env.S3_FORCE_PATH_STYLE, true),
    maxImageUploadBytes: parsePositiveInt(
      process.env.S3_MAX_IMAGE_UPLOAD_BYTES,
      DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
    ),
    presignTtlSeconds: parsePositiveInt(
      process.env.S3_PRESIGN_TTL_SECONDS,
      DEFAULT_PRESIGN_TTL_SECONDS,
    ),
  };
}

/** Exact browser origin used by signed object URLs. Never infer this from request headers. */
export function getStorageBrowserOrigin(): string | undefined {
  const endpoint = env("S3_ENDPOINT");
  try {
    const parsed = new URL(endpoint);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function getMaxImageUploadBytes() {
  return parsePositiveInt(
    process.env.S3_MAX_IMAGE_UPLOAD_BYTES,
    DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
  );
}

function getClient(config: StorageConfig) {
  const cacheKey = JSON.stringify({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    bucket: config.bucket,
    forcePathStyle: config.forcePathStyle,
  });

  if (clientCache?.cacheKey === cacheKey) {
    return clientCache.client;
  }

  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Avoid auto-injecting checksum params for presigned PUT URLs. Some
    // S3-compatible providers (e.g. Garage/R2) reject mismatched hoisted CRCs.
    requestChecksumCalculation: "WHEN_REQUIRED",
  };

  const credentials = resolveS3Credentials(
    config.accessKeyId,
    config.secretAccessKey,
  );

  // Only pin explicit credentials when both keys are provided. Otherwise leave
  // `credentials` unset so the AWS SDK resolves them from its default provider
  // chain (EC2 instance profile, ECS task role, EKS IRSA, env, shared config),
  // which is how IAM-role-based access works.
  if (credentials) {
    clientConfig.credentials = credentials;
  }

  const client = new S3Client(clientConfig);
  clientCache = { cacheKey, client };
  return client;
}

export function validateTaskAssetUploadInput(
  contentType: string,
  size: number,
) {
  validateUploadInput(contentType, size, getMaxImageUploadBytes());
}

export async function createTaskImageUploadUrl(
  context: TaskImageUploadContext,
): Promise<TaskImageUploadUrl> {
  const config = getStorageConfig();
  const client = getClient(config);
  const rawKey = buildObjectKey(context);
  const key = applyKeyPrefix(config.keyPrefix, rawKey);

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: context.contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: config.presignTtlSeconds,
  });

  return {
    key,
    uploadUrl,
    headers: {
      "Content-Type": context.contentType,
    },
  };
}

export function assertStorageConfigured() {
  return getStorageConfig();
}

export function assertTaskImageKeyMatchesContext(
  key: string,
  context: Omit<TaskImageUploadContext, "filename" | "contentType">,
) {
  const config = getStorageConfig();
  return matchesKeyContext(key, context, config.keyPrefix);
}

export async function getPrivateObject(key: string): Promise<AssetObject> {
  const config = getStorageConfig();
  const client = getClient(config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error("Storage object body is missing.");
  }

  const body =
    "transformToWebStream" in response.Body
      ? response.Body.transformToWebStream()
      : Readable.toWeb(response.Body as Readable);

  return {
    body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    etag: response.ETag,
    lastModified: response.LastModified,
  };
}

/**
 * Issue #28 (attachments) -- the S3 equivalent of `filesystem.ts`'s
 * `createAttachmentUploadUrl`: a presigned PUT for a caller-supplied `key` rather than
 * one built from a `TaskImageUploadContext`. `maxBytes` is accepted for signature parity
 * with the filesystem driver's token-bound ceiling, but is NOT enforced by S3 itself on
 * a plain presigned PUT (that would need a presigned POST with a
 * `content-length-range` policy condition, not built here -- flagged in the PR body);
 * the attachment module enforces the ceiling at the application layer instead, both
 * before minting this URL and again on `complete` by checking the object's actual
 * stored size.
 */
export async function createAttachmentUploadUrl(
  key: string,
  contentType: string,
  _maxBytes: number,
): Promise<{
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
}> {
  const config = getStorageConfig();
  const client = getClient(config);
  const prefixedKey = applyKeyPrefix(config.keyPrefix, key);

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: prefixedKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: config.presignTtlSeconds,
  });

  return {
    key: prefixedKey,
    uploadUrl,
    headers: { "Content-Type": contentType },
  };
}

/**
 * `attachments.md` AT-5: a presigned GET, five-minute lifetime, `Content-Disposition:
 * attachment` so the browser always downloads rather than navigates.
 */
export async function createAttachmentDownloadUrl(
  key: string,
  filename: string,
  options: {
    contentType?: string;
    disposition: "attachment" | "inline";
  } = { disposition: "attachment" },
): Promise<string> {
  const config = getStorageConfig();
  const client = getClient(config);

  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ResponseContentDisposition: buildAttachmentContentDisposition(
      filename,
      options.disposition,
    ),
    ...(options.contentType
      ? { ResponseContentType: options.contentType }
      : {}),
  });

  return getSignedUrl(client, command, {
    expiresIn: DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
  });
}

/**
 * Issue #28 (attachments), B3 security-review fix (2026-09-27): `HeadObjectCommand` gets
 * the real stored size with no body transfer at all; a single ranged `GetObjectCommand`
 * (`Range: bytes=0-N`) fetches only the bytes the magic-byte sniff actually needs. Neither
 * call buffers the whole object -- the previous shape (`getPrivateObject` +
 * `new Response(body).arrayBuffer()`) downloaded the entire object into memory just to
 * check its size and look at the first 512 bytes.
 */
export async function getObjectSizeAndHeader(
  key: string,
  headerBytes: number,
): Promise<{ contentLength: number | undefined; header: Buffer }> {
  const config = getStorageConfig();
  const client = getClient(config);

  const head = await client.send(
    new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
  );

  if (headerBytes <= 0 || !head.ContentLength) {
    return { contentLength: head.ContentLength, header: Buffer.alloc(0) };
  }

  const rangeEnd = Math.min(headerBytes, head.ContentLength) - 1;
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Range: `bytes=0-${rangeEnd}`,
    }),
  );
  if (!response.Body) {
    throw new Error("Storage object body is missing.");
  }

  const bytes =
    "transformToByteArray" in response.Body
      ? await response.Body.transformToByteArray()
      : new Uint8Array(
          await new Response(response.Body as BodyInit).arrayBuffer(),
        );

  return { contentLength: head.ContentLength, header: Buffer.from(bytes) };
}

function encodeCopySourceKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/**
 * Issue #28 (attachments), B2 security-review fix (2026-09-27): the S3 equivalent of
 * `filesystem.ts`'s `finalizeAttachmentObject` -- a plain presigned PUT has no way to be
 * revoked once `complete` has validated the object, so the object is copied to a key that
 * was never presigned and the original is deleted, rather than trusting the presigned PUT
 * URL to stop working on its own.
 *
 * N2 security-review fix (2026-09-27, delta 2): this was already copy-then-delete
 * internally, but `complete-attachment.ts` used to call it AFTER reading/checking the
 * object at `oldKey` -- a PUT to the still-presigned `oldKey` landing in that gap could
 * change what this then copied, so what got checked and what got served could differ.
 * `complete-attachment.ts` now calls this FIRST and reads/checks only `newKey` afterwards:
 * `CopyObjectCommand` takes an independent, immutable snapshot of whatever is at `oldKey`
 * the instant it runs, and no later write to `oldKey` can retroactively change that
 * snapshot. Deliberately not adding `CopySourceIfMatch` against a HEAD-observed ETag here
 * -- that would only help detect (never prevent) an overwrite in a gap that no longer
 * exists once the copy is the very first thing that touches the object, so it would add
 * complexity without closing anything the reorder doesn't already close.
 */
export async function finalizeAttachmentObject(
  oldKey: string,
  newKey: string,
): Promise<void> {
  const config = getStorageConfig();
  const client = getClient(config);

  await client.send(
    new CopyObjectCommand({
      Bucket: config.bucket,
      CopySource: `${config.bucket}/${encodeCopySourceKey(oldKey)}`,
      Key: newKey,
    }),
  );
  await client.send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: oldKey }),
  );
}

export async function deleteS3Object(key: string): Promise<void> {
  const config = getStorageConfig();
  const client = getClient(config);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
}
