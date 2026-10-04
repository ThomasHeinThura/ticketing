/**
 * Storage driver selector.
 *
 * `TASKDESK_STORAGE_DRIVER` picks which backend implementation the exported functions here
 * dispatch to — `filesystem` (the default; a fresh install needs no configuration at all,
 * per `docs/01-architecture/storage-and-attachments.md`) or `s3`. The driver is read fresh on
 * every call rather than cached at import time, so a test (or, in principle, a process whose
 * environment is reloaded) can switch drivers and see the switch take effect immediately —
 * see `tests/api/storage/index.test.ts`.
 *
 * Application code (`index.ts`, `task/index.ts`, `cleanup-assets.ts`) imports from here, never
 * from `./s3` or `./filesystem` directly, so a caller never hardcodes which backend is active.
 */

import * as filesystemDriver from "./filesystem";
import * as s3Driver from "./s3";
import {
  type AssetObject,
  type AttachmentRepresentation,
  applyKeyPrefix,
  attachmentDisposition,
  buildAttachmentContentDisposition,
  buildObjectKey,
  buildObjectKeyPrefix,
  getFileExtension,
  isImageContentType,
  isInlineAttachmentMimeType,
  parseBoolean,
  parsePositiveInt,
  sanitizePathSegment,
  type TaskImageUploadContext,
  type TaskImageUploadUrl,
  toFinalAttachmentObjectKey,
} from "./shared";

export type {
  AssetObject,
  AttachmentRepresentation,
  TaskImageUploadContext,
  TaskImageUploadUrl,
  UploadSurface,
} from "./shared";

// Driver-agnostic pure helpers — identical behaviour regardless of which backend is active, so
// there is nothing to dispatch on. Re-exported here so callers have one import surface.
export {
  applyKeyPrefix,
  attachmentDisposition,
  buildAttachmentContentDisposition,
  buildObjectKey,
  buildObjectKeyPrefix,
  getFileExtension,
  isImageContentType,
  isInlineAttachmentMimeType,
  parseBoolean,
  parsePositiveInt,
  sanitizePathSegment,
  toFinalAttachmentObjectKey,
};

export type StorageDriverName = "filesystem" | "s3";

/**
 * Resolves the active storage driver from `TASKDESK_STORAGE_DRIVER`. Empty/unset defaults to
 * `filesystem` — "a fresh install runs storage.filesystem until an administrator chooses
 * otherwise" (decision log, 2026-09-05). Anything other than `filesystem`/`s3` (case-
 * insensitively) is a configuration error, not silently rounded to a default: an operator who
 * mistyped the value should find out immediately, not discover months later that their images
 * were never actually landing on the S3 bucket they thought they configured.
 */
export function getStorageDriver(): StorageDriverName {
  const raw = (process.env.TASKDESK_STORAGE_DRIVER || "").trim().toLowerCase();
  if (raw === "" || raw === "filesystem") return "filesystem";
  if (raw === "s3") return "s3";
  throw new Error(
    `Unknown TASKDESK_STORAGE_DRIVER "${raw}". Expected "filesystem" or "s3".`,
  );
}

function driver() {
  return getStorageDriver() === "s3" ? s3Driver : filesystemDriver;
}

export function validateTaskAssetUploadInput(
  contentType: string,
  size: number,
) {
  return driver().validateTaskAssetUploadInput(contentType, size);
}

export function assertTaskImageKeyMatchesContext(
  key: string,
  context: Omit<
    TaskImageUploadContext,
    "filename" | "contentType" | "apiBaseUrl"
  >,
) {
  return driver().assertTaskImageKeyMatchesContext(key, context);
}

export async function assertStorageConfigured() {
  return await driver().assertStorageConfigured();
}

export async function createTaskImageUploadUrl(
  context: TaskImageUploadContext,
): Promise<TaskImageUploadUrl> {
  return driver().createTaskImageUploadUrl(context);
}

export async function getPrivateObject(key: string): Promise<AssetObject> {
  return driver().getPrivateObject(key);
}

/**
 * Deletes one stored object, regardless of driver. Named without "S3" (unlike `s3.ts`'s own
 * `deleteS3Object`, kept as-is there for backward compatibility) because callers going through
 * the selector should never need to know or care which backend actually stores the bytes.
 */
export async function deleteStorageObject(key: string): Promise<void> {
  if (getStorageDriver() === "s3") {
    return s3Driver.deleteS3Object(key);
  }
  return filesystemDriver.deleteObject(key);
}

/**
 * Issue #28 (attachments) -- presigned direct-PUT for a caller-chosen key, regardless of
 * driver. `maxBytes` travels with the token on the filesystem driver (enforced at write
 * time); on S3 it is currently application-level only -- see `s3.ts`'s own comment.
 */
export async function createAttachmentUploadUrl(
  key: string,
  contentType: string,
  maxBytes: number,
  apiBaseUrl?: string,
): Promise<{
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
}> {
  if (getStorageDriver() === "s3") {
    return s3Driver.createAttachmentUploadUrl(key, contentType, maxBytes);
  }
  return filesystemDriver.createAttachmentUploadUrl(
    key,
    contentType,
    maxBytes,
    apiBaseUrl,
  );
}

/** Issue #28 -- presigned download (`attachments.md` AT-5), regardless of driver. */
export async function createAttachmentDownloadUrl(
  key: string,
  filename: string,
  apiBaseUrl?: string,
  options: {
    contentType?: string;
    representation: AttachmentRepresentation;
  } = {
    representation: "download",
  },
): Promise<string> {
  const contentType = options.contentType ?? "application/octet-stream";
  const disposition = attachmentDisposition(
    options.representation,
    contentType,
  );
  if (options.representation === "preview" && disposition !== "inline") {
    throw new Error("This attachment type cannot be previewed.");
  }
  if (getStorageDriver() === "s3") {
    return s3Driver.createAttachmentDownloadUrl(key, filename, {
      contentType: options.contentType,
      disposition,
    });
  }
  return filesystemDriver.createAttachmentDownloadUrl(
    key,
    filename,
    apiBaseUrl,
    {
      contentType,
      representation: options.representation,
      disposition,
    },
  );
}

export function getStorageBrowserOrigin(): string | undefined {
  return getStorageDriver() === "s3"
    ? s3Driver.getStorageBrowserOrigin()
    : undefined;
}

/**
 * Issue #28 (attachments), B3 security-review fix (2026-09-27) -- the object's real stored
 * size (no body read) plus only its first `headerBytes` bytes (a bounded, ranged read),
 * regardless of driver. See each driver's own comment for why this replaces buffering the
 * entire object just to check a size and sniff a handful of magic bytes.
 */
export async function getObjectSizeAndHeader(
  key: string,
  headerBytes: number,
): Promise<{ contentLength: number | undefined; header: Buffer }> {
  if (getStorageDriver() === "s3") {
    return s3Driver.getObjectSizeAndHeader(key, headerBytes);
  }
  return filesystemDriver.getObjectSizeAndHeader(key, headerBytes);
}

/**
 * Issue #28 (attachments), B2 security-review fix (2026-09-27) -- moves a `complete`d
 * object from its pending (presigned-writable) key to a final key nothing was ever
 * presigned to write to, regardless of driver.
 */
export async function finalizeStorageObject(
  oldKey: string,
  newKey: string,
): Promise<void> {
  if (getStorageDriver() === "s3") {
    return s3Driver.finalizeAttachmentObject(oldKey, newKey);
  }
  return filesystemDriver.finalizeAttachmentObject(oldKey, newKey);
}
