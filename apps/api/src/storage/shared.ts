/**
 * Storage-driver-agnostic types and pure helpers.
 *
 * Everything here is free of I/O and free of environment-variable reads, on purpose: it is
 * shared verbatim between `s3.ts` and `filesystem.ts` so the object-key shape, the
 * traversal-safety check on a finalized key, and the upload-size validation behave
 * identically no matter which backend is active. A driver module supplies only the config
 * (key prefix, max bytes) these functions take as explicit parameters — neither this file nor
 * its callers may read the environment here, because `check:env`
 * (scripts/ci/check-env.mjs) attributes every environment read to the literal file it
 * appears in, and centralizing those reads through a shared parameterized helper would turn
 * them into computed, unattributable reads in a file `configuration-reference.md` cannot
 * approve by name.
 */

import { createId } from "@paralleldrive/cuid2";

export const DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
export const DEFAULT_UPLOAD_URL_TTL_SECONDS = 300;

const allowedImageMimeTypes = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isImageContentType(contentType: string) {
  return allowedImageMimeTypes.has(contentType.toLowerCase());
}

export type UploadSurface = "description" | "comment";

export type TaskImageUploadContext = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  surface: UploadSurface;
  filename: string;
  contentType: string;
  /**
   * The caller's own public API origin — the `KANEO_API_URL` environment variable when set,
   * else the request's own origin — the same source `finalizeTaskImageUploadRoute` reads
   * before normalizing it for the asset URL it returns. NOT expected to already be
   * normalized (no guaranteed `/api` suffix, may have a trailing slash): the driver that
   * uses this value normalizes it itself, so a caller does not need to know that contract.
   *
   * `storage.s3` ignores this: a presigned S3 URL points at the S3 endpoint, never at this
   * API. `storage.filesystem` needs it, because its "presigned URL" is a route on this API
   * process itself, and this module has no Hono context of its own to read the request's
   * origin from.
   */
  apiBaseUrl?: string;
};

export type TaskImageUploadUrl = {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

export type AssetObject = {
  body: unknown;
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
  lastModified: Date | undefined;
};

export function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value?.trim() || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function sanitizePathSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "file"
  );
}

export function getFileExtension(filename: string) {
  const normalized = filename.trim();
  const extension = normalized.includes(".")
    ? normalized.split(".").pop() || ""
    : "";

  return sanitizePathSegment(extension).slice(0, 12);
}

export function buildObjectKeyPrefix(
  context: Omit<
    TaskImageUploadContext,
    "filename" | "contentType" | "apiBaseUrl"
  >,
) {
  const surfaceFolder =
    context.surface === "comment" ? "comments" : "descriptions";

  return [
    "workspace",
    sanitizePathSegment(context.workspaceId),
    "project",
    sanitizePathSegment(context.projectId),
    "task",
    sanitizePathSegment(context.taskId),
    surfaceFolder,
  ].join("/");
}

export function buildObjectKey(context: TaskImageUploadContext) {
  const extension = getFileExtension(context.filename);
  const objectKeyPrefix = buildObjectKeyPrefix(context);
  const timestamp = Date.now();
  const randomId = createId();

  const baseName = sanitizePathSegment(
    context.filename.replace(/\.[^/.]+$/, "") || "image",
  ).slice(0, 64);

  const fileName = extension
    ? `${baseName}-${timestamp}-${randomId}.${extension}`
    : `${baseName}-${timestamp}-${randomId}`;

  return `${objectKeyPrefix}/${fileName}`;
}

export function applyKeyPrefix(prefix: string, key: string) {
  if (!prefix) return key;
  const trimmed = prefix.replace(/\/+$/, "");
  return `${trimmed}/${key}`;
}

/**
 * The pure core of "does this finalized key belong to this task context". Both drivers expose
 * this as `assertTaskImageKeyMatchesContext(key, context)`, supplying their own `keyPrefix`
 * (S3's `S3_KEY_PREFIX`; the filesystem driver has none today, so it always passes `""`).
 *
 * The prefix alone is not enough: a suffix like `../../../workspace/victim/secret.png` would
 * still start with the right prefix textually. The suffix after the prefix must therefore be a
 * single safe path segment — no `/`, no leading `.` — so nothing can walk back out of the
 * task's own folder.
 */
export function matchesKeyContext(
  key: string,
  context: Omit<
    TaskImageUploadContext,
    "filename" | "contentType" | "apiBaseUrl"
  >,
  keyPrefix: string,
): boolean {
  const objectPrefix = buildObjectKeyPrefix(context);
  const fullPrefix = `${applyKeyPrefix(keyPrefix, objectPrefix)}/`;

  if (!key.startsWith(fullPrefix)) {
    return false;
  }

  const suffix = key.slice(fullPrefix.length);
  return /^[A-Za-z0-9._-]+$/.test(suffix) && !suffix.startsWith(".");
}

/**
 * The pure core of upload-size validation, driver-independent. Each driver resolves its own
 * `maxBytes` (S3 from `S3_MAX_IMAGE_UPLOAD_BYTES`; filesystem from its own default, see
 * `filesystem.ts`) and calls through to this.
 */
export function validateUploadInput(
  contentType: string,
  size: number,
  maxBytes: number,
): void {
  if (!contentType.trim()) {
    throw new Error("A valid content type is required.");
  }

  if (size <= 0) {
    throw new Error("Upload size must be greater than zero.");
  }

  if (size > maxBytes) {
    throw new Error(
      `Upload exceeds the maximum upload size of ${Math.floor(maxBytes / (1024 * 1024))}MB.`,
    );
  }
}
