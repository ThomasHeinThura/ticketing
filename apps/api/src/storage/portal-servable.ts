import * as filesystemDriver from "./filesystem";
import {
  createAttachmentDownloadUrl,
  createAttachmentUploadUrl,
  getStorageDriver,
} from "./index";

/**
 * CP-19: what the portal host serves from the filesystem storage driver (the default; local SIT
 * and Technexus use it). On S3 every signed URL points at the bucket, never at the portal host.
 *
 * 1. **Downloads** of submission objects (`workspace/<id>/submission/<id>/attachment/...`) and
 *    work-item objects (`workspace/<id>/work-item/<id>/attachment/...`), pending or final: only
 *    through the portal-bound route `GET /api/storage/portal-download` (Thomas, 3 November 2026).
 *    Only the portal `own_request` / `own_submission` routes mint those links, after their
 *    ownership and reach check. The token has its own key derivation (an agent-minted URL is
 *    never accepted) and binds the key, the customer person and a five-minute expiry. The route
 *    also requires the portal session on the request to be that same person.
 * 2. **Uploads**: a pending submission key through the generic signed
 *    `PUT /api/storage/filesystem-attachment-upload` (its HMAC binds the exact key, size ceiling
 *    and expiry); a pending work-item key only through the portal-bound
 *    `PUT /api/storage/portal-attachment-upload`, which also binds the customer person.
 *
 * Every other agent route stays denied on the portal host, including the generic
 * `GET /api/storage/filesystem-download` for every key, so an unbound download link is refused
 * there. The agent host keeps serving the generic routes to staff unchanged.
 */
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

function isSubmissionDownloadKey(key: string): boolean {
  return SUBMISSION_PENDING_KEY.test(key) || SUBMISSION_FINAL_KEY.test(key);
}

/** A pending work-item attachment key: the only key a portal upload token is minted for. */
export function isWorkItemUploadKey(key: string): boolean {
  return !key.includes("..") && WORK_ITEM_PENDING_KEY.test(key);
}

/** A work-item attachment key (pending or final). */
function isWorkItemDownloadKey(key: string): boolean {
  return (
    !key.includes("..") &&
    (WORK_ITEM_PENDING_KEY.test(key) || WORK_ITEM_FINAL_KEY.test(key))
  );
}

/**
 * A submission or work-item attachment key (pending or final): what a portal download token may
 * name (CP-19, 3 November 2026).
 */
export function isPortalDownloadKey(key: string): boolean {
  return (
    !key.includes("..") &&
    (isSubmissionDownloadKey(key) || isWorkItemDownloadKey(key))
  );
}

/** The portal host's filesystem storage request guard (CP-19). */
export function isPortalStorageRequest(
  method: string,
  path: string,
  key: string | undefined,
): boolean {
  if (key === undefined || key.includes("..")) return false;
  if (method === "PUT" && path === "/api/storage/filesystem-attachment-upload")
    return SUBMISSION_PENDING_KEY.test(key);
  if (method === "PUT" && path === PORTAL_UPLOAD_PATH)
    return isWorkItemUploadKey(key);
  // Downloads only through the person-bound route; the generic, unbound
  // `GET /api/storage/filesystem-download` is never admitted here.
  if ((method === "GET" || method === "HEAD") && path === PORTAL_DOWNLOAD_PATH)
    return isPortalDownloadKey(key);
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

/**
 * The download URL a portal route hands the customer, after its own reach check. On the
 * filesystem driver a submission or work-item key gets a portal-bound link for `personId`, which
 * must be the person behind the portal session (Thomas, 3 November 2026). On S3 it is the
 * bucket's five-minute presigned GET, bound to the key and expiry only.
 */
export async function createPortalAttachmentDownloadUrl(input: {
  objectKey: string;
  filename: string;
  personId: string;
  apiBaseUrl: string;
}): Promise<string> {
  if (
    getStorageDriver() === "filesystem" &&
    isPortalDownloadKey(input.objectKey)
  )
    return filesystemDriver.createPortalAttachmentDownloadUrl(
      input.objectKey,
      input.filename,
      input.personId,
      input.apiBaseUrl,
    );
  return createAttachmentDownloadUrl(
    input.objectKey,
    input.filename,
    input.apiBaseUrl,
  );
}

/**
 * The upload URL a portal presign hands the customer. On the filesystem driver a work-item key
 * gets a portal-bound PUT for `personId`; anything else keeps the driver's own presign.
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
  if (
    getStorageDriver() === "filesystem" &&
    isWorkItemUploadKey(input.objectKey)
  )
    return filesystemDriver.createPortalAttachmentUploadUrl(
      input.objectKey,
      input.contentType,
      input.maxBytes,
      input.personId,
      input.apiBaseUrl,
    );
  return createAttachmentUploadUrl(
    input.objectKey,
    input.contentType,
    input.maxBytes,
    input.apiBaseUrl,
    input.declaredSize,
  );
}
