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
  applyKeyPrefix,
  buildObjectKey,
  buildObjectKeyPrefix,
  getFileExtension,
  isImageContentType,
  parseBoolean,
  parsePositiveInt,
  sanitizePathSegment,
  type TaskImageUploadContext,
  type TaskImageUploadUrl,
} from "./shared";

export type {
  AssetObject,
  TaskImageUploadContext,
  TaskImageUploadUrl,
  UploadSurface,
} from "./shared";

// Driver-agnostic pure helpers — identical behaviour regardless of which backend is active, so
// there is nothing to dispatch on. Re-exported here so callers have one import surface.
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
