import * as filesystemDriver from "./filesystem";
import { createAttachmentUploadUrl, getStorageDriver } from "./index";

/** Portal storage host guard and person-bound download URL creation. */
const SEGMENT = "[A-Za-z0-9_-]+";
const FILE = "[A-Za-z0-9_.-]+";
const FINAL_FILE = `final\\/[a-z0-9]+-${FILE}`;

function attachmentKeyPattern(
  parent: "submission" | "work-item",
  file: string,
) {
  return new RegExp(
    `^workspace\\/${SEGMENT}\\/${parent}\\/${SEGMENT}\\/attachment\\/${SEGMENT}\\/${file}$`,
    "u",
  );
}

const SUBMISSION_PENDING_KEY = attachmentKeyPattern("submission", FILE);
/**
 * `complete` moves the object to `<pending dir>/final/<cuid2 token>-<file>`
 * (`toFinalAttachmentObjectKey`), and the attachment row then points at that key, so a download
 * carries it. Downloads only: nothing ever mints an upload token for a finalized key.
 */
const SUBMISSION_FINAL_KEY = attachmentKeyPattern("submission", FINAL_FILE);
const WORK_ITEM_PENDING_KEY = attachmentKeyPattern("work-item", FILE);
const WORK_ITEM_FINAL_KEY = attachmentKeyPattern("work-item", FINAL_FILE);

export const PORTAL_UPLOAD_PATH = "/api/storage/portal-attachment-upload";
export const PORTAL_DOWNLOAD_PATH = "/api/storage/portal-download";

/** Match filesystem path safety: embedded dots are safe; whole dot segments are not. */
function hasUnsafeKeySegments(key: string): boolean {
  return key
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

export function isSubmissionAttachmentKey(key: string): boolean {
  return SUBMISSION_PENDING_KEY.test(key) || SUBMISSION_FINAL_KEY.test(key);
}

/** A pending work-item attachment key. */
export function isWorkItemUploadKey(key: string): boolean {
  return !hasUnsafeKeySegments(key) && WORK_ITEM_PENDING_KEY.test(key);
}

/** Only pending submission or work-item keys may be uploaded on the portal. */
export function isPortalUploadKey(key: string): boolean {
  return (
    !hasUnsafeKeySegments(key) &&
    (SUBMISSION_PENDING_KEY.test(key) || WORK_ITEM_PENDING_KEY.test(key))
  );
}

/** A work-item attachment key (pending or final). */
function isWorkItemDownloadKey(key: string): boolean {
  return (
    !hasUnsafeKeySegments(key) &&
    (WORK_ITEM_PENDING_KEY.test(key) || WORK_ITEM_FINAL_KEY.test(key))
  );
}

/**
 * A submission or work-item attachment key (pending or final): what a portal download token may
 * name (CP-19, 3 November 2026).
 */
export function isPortalDownloadKey(key: string): boolean {
  return (
    !hasUnsafeKeySegments(key) &&
    (isSubmissionAttachmentKey(key) || isWorkItemDownloadKey(key))
  );
}

/** The portal host's filesystem storage request guard (CP-19). */
export function isPortalStorageRequest(
  method: string,
  path: string,
  key: string | undefined,
): boolean {
  if ((method === "GET" || method === "HEAD") && path === PORTAL_DOWNLOAD_PATH)
    return true;
  if (key === undefined || hasUnsafeKeySegments(key)) return false;
  if (method === "PUT" && path === PORTAL_UPLOAD_PATH)
    return isPortalUploadKey(key);
  return false;
}

/**
 * Whether a customer's browser on the portal host can fetch this object. Always on S3; on the
 * filesystem driver for submission and work-item attachment keys, which are the only shapes the
 * application writes.
 */
export function portalCanDownloadObject(objectKey: string): boolean {
  return getStorageDriver() !== "filesystem" || isPortalDownloadKey(objectKey);
}

/** Mint a person-bound portal URL after checking current reach. */
export async function createPortalAttachmentDownloadUrl(input: {
  scope: "request" | "submission";
  ref: string;
  id: string;
  personId: string;
  apiBaseUrl: string;
}): Promise<string> {
  return filesystemDriver.createPortalDownloadV2(input);
}

/**
 * The upload URL a portal presign hands the customer. On the filesystem driver a pending
 * submission or work-item key gets a portal-bound PUT for `personId`; S3 keeps its own presign.
 */
export async function createPortalAttachmentUploadUrl(input: {
  objectKey: string;
  contentType: string;
  maxBytes: number;
  personId: string;
  apiBaseUrl: string;
  declaredSize: number;
}): Promise<{
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
}> {
  if (getStorageDriver() === "filesystem") {
    if (!isPortalUploadKey(input.objectKey))
      throw new Error("Invalid portal attachment upload key.");
    return filesystemDriver.createPortalAttachmentUploadUrl(
      input.objectKey,
      input.contentType,
      input.maxBytes,
      input.personId,
      input.apiBaseUrl,
    );
  }
  return createAttachmentUploadUrl(
    input.objectKey,
    input.contentType,
    input.maxBytes,
    input.apiBaseUrl,
    input.declaredSize,
  );
}
