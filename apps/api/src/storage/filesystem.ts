/**
 * `storage.filesystem` — the default storage driver on a fresh install.
 *
 * Covers the one use case that exists in the application today: task image uploads (an image
 * pasted or attached into a task description or comment), through the exact same
 * `createTaskImageUploadUrl` / `assertTaskImageKeyMatchesContext` / `getPrivateObject` /
 * `deleteObject` surface `s3.ts` exposes. See `docs/01-architecture/storage-and-attachments.md`
 * for the much larger FUTURE `packages/plugins-contracts` `StorageBackend` architecture this is
 * deliberately NOT: that is the P1 Attachments feature, currently blocked by its own open spec
 * review (`docs/07-planning/reviews/2026-09-05/features-core-servicedesk.md` §6).
 *
 * ## No true presigned URL on a filesystem
 *
 * S3's `createTaskImageUploadUrl` returns a URL the browser PUTs to *directly*, signed so only
 * the holder of the URL can write that exact key before it expires. A local filesystem has no
 * such thing — there is no separate storage endpoint to sign a capability against. The
 * equivalent implemented here is a route on this same API process
 * (`PUT /api/storage/filesystem-upload`) that accepts the raw bytes, gated by a short-lived,
 * key-scoped upload token minted with an HKDF-derived key from `TASKDESK_AUTH_SECRET` (already
 * a required bootstrap variable — no new secret needed). The token binds the exact object key
 * and an expiry into an HMAC-SHA256 tag, verified with a constant-time comparison, so holding
 * the URL is the same kind of bearer capability an S3 presigned URL is: nobody without the
 * signed token can write to (or overwrite) a filesystem key, and the token is useless after
 * `DEFAULT_UPLOAD_URL_TTL_SECONDS`. This keeps `createTaskImageUploadRoute` /
 * `finalizeTaskImageUploadRoute` and the web client's upload flow (`fetch(upload.uploadUrl,
 * {method: "PUT", headers: upload.headers, body: file})`) completely unchanged — the only new
 * surface is the route that receives the PUT, registered directly in `index.ts` next to
 * `getAsset`, above the session-auth guard, exactly the way `getAsset` itself authenticates a
 * request with no browser session by checking something else (there, workspace/project
 * membership computed from the asset row; here, the signed token).
 *
 * ## Path-traversal and symlink defense
 *
 * A malformed or malicious key is far less forgiving on a real filesystem than against S3 (an
 * S3 PUT with a `../`-laden key just becomes a literally-named object; the same key joined onto
 * a filesystem root can escape it entirely). Every read, write and delete here re-verifies the
 * resolved path independently of `assertTaskImageKeyMatchesContext`'s own suffix check — see
 * `resolveWithinRoot` (rejects `..`, absolute paths, backslashes and null bytes before any I/O)
 * and `assertNoSymlinkEscape` (defense in depth against a symlink planted somewhere in the
 * storage root redirecting a write or read outside it; not fully TOCTOU-proof against an
 * attacker who already has filesystem write access to the volume — which is a much larger
 * compromise than this module can defend against — but it does refuse the direct case: an
 * existing symlink at or above the target path pointing outside `TASKDESK_STORAGE_FILESYSTEM_ROOT`).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp, { type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import {
  type AssetObject,
  applyKeyPrefix,
  buildObjectKey,
  buildObjectKeyPrefix,
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

// Re-exported so a caller reaching this driver directly (tests, mainly — normal application
// code goes through the selector in ./index) sees the same surface s3.ts does.
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

// Matches the directory the Dockerfile itself creates (owned by the runtime user) and the
// path compose.yml/charts/taskdesk mount the persistent volume at — see
// docs/05-operations/configuration-reference.md. Exported so a test can assert the default
// without performing I/O against a path this process may not be able to write to on every host.
export const DEFAULT_ROOT = "/app/data/attachments";

export class StoragePathError extends Error {}
export class StorageNotFoundError extends Error {}

type FilesystemStorageConfig = {
  root: string;
  maxUploadBytes: number;
  uploadUrlTtlSeconds: number;
};

function getFilesystemRootEnv(): string {
  return process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT?.trim() || "";
}

function getAuthSecretEnv(): string {
  return process.env.TASKDESK_AUTH_SECRET?.trim() || "";
}

function getFilesystemConfig(): FilesystemStorageConfig {
  return {
    root: path.resolve(getFilesystemRootEnv() || DEFAULT_ROOT),
    // Not independently configurable today: there is no bootstrap env var for it, on purpose
    // (AGENTS.md rule 2 — "if you're about to add one, stop"). The documented future home is
    // God Mode → Storage → "max file size" (configuration-reference.md), once that surface
    // exists; until then this matches S3's own built-in default exactly.
    maxUploadBytes: DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
    uploadUrlTtlSeconds: DEFAULT_UPLOAD_URL_TTL_SECONDS,
  };
}

/**
 * Confirms the filesystem driver can actually be used: the configured root exists (creating it
 * if this is a fresh volume) and is writable by this process. Mirrors `s3.ts`'s
 * `assertStorageConfigured`, which validates config without a network call; the closest local
 * equivalent to "network call" here is a filesystem stat/access check, not free but cheap.
 */
export async function assertStorageConfigured(): Promise<FilesystemStorageConfig> {
  const config = getFilesystemConfig();
  try {
    await fsp.mkdir(config.root, { recursive: true });
    await fsp.access(config.root, fs.constants.W_OK);
  } catch (error) {
    throw new Error(
      `Filesystem storage is not usable: the configured root "${config.root}" could not be created or is not writable (${error instanceof Error ? error.message : String(error)}). Set TASKDESK_STORAGE_FILESYSTEM_ROOT to a writable, Docker-mountable path, or mount a volume at the default (${DEFAULT_ROOT}).`,
    );
  }
  return config;
}

export function validateTaskAssetUploadInput(
  contentType: string,
  size: number,
) {
  validateUploadInput(contentType, size, DEFAULT_MAX_IMAGE_UPLOAD_BYTES);
}

export function assertTaskImageKeyMatchesContext(
  key: string,
  context: Omit<TaskImageUploadContext, "filename" | "contentType">,
) {
  // The filesystem driver has no equivalent of S3_KEY_PREFIX today — every key is rooted
  // directly under the configured storage root.
  return matchesKeyContext(key, context, "");
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

/**
 * Rejects a key outright before it ever reaches a path.join/fs call: empty, a null byte, a
 * backslash (mixed-separator tricks), an absolute path (POSIX or a Windows drive letter), or
 * any `.`/`..`/empty path segment. `assertTaskImageKeyMatchesContext`'s suffix regex
 * (`^[A-Za-z0-9._-]+$`, no `/`) already makes most of this unreachable for a key this module
 * itself minted — this function does not trust that caller and re-derives safety from the key
 * text alone, because a filesystem write is far less forgiving than an S3 PUT.
 */
function assertSafeRelativeKey(key: string): void {
  if (!key) {
    throw new StoragePathError("Empty storage key.");
  }
  if (key.includes(" ")) {
    throw new StoragePathError("Storage key contains a null byte.");
  }
  if (key.includes("\\")) {
    throw new StoragePathError("Storage key contains a backslash.");
  }
  if (path.posix.isAbsolute(key) || /^[a-zA-Z]:[/\\]/.test(key)) {
    throw new StoragePathError("Storage key must be a relative path.");
  }
  const segments = key.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new StoragePathError(
        `Storage key contains an unsafe path segment: "${segment || "(empty)"}".`,
      );
    }
  }
}

function withTrailingSep(dir: string): string {
  return dir.endsWith(path.sep) ? dir : dir + path.sep;
}

/**
 * Resolves `key` against `resolvedRoot`, refusing anything that normalizes outside it. Pure
 * string/path resolution — no I/O, so this alone does not defend against a symlink; see
 * `assertNoSymlinkEscape` for that.
 */
function resolveWithinRoot(resolvedRoot: string, key: string): string {
  assertSafeRelativeKey(key);
  const candidate = path.resolve(resolvedRoot, key);
  if (
    candidate !== resolvedRoot &&
    !candidate.startsWith(withTrailingSep(resolvedRoot))
  ) {
    throw new StoragePathError(
      "Storage key resolves outside the storage root.",
    );
  }
  return candidate;
}

/** Walks up from `startDir` to the nearest ancestor directory that actually exists. */
async function nearestExistingAncestor(startDir: string): Promise<string> {
  let current = startDir;
  for (;;) {
    try {
      await fsp.lstat(current);
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return current;
      current = parent;
    }
  }
}

/**
 * Defense in depth against a symlink somewhere in the path (not just in the final key
 * component) redirecting I/O outside the storage root. Resolves the nearest existing ancestor
 * directory of `targetDir` to its real path and refuses if that real path has escaped root.
 */
async function assertNoSymlinkEscape(
  targetDir: string,
  resolvedRoot: string,
): Promise<void> {
  const ancestor = await nearestExistingAncestor(targetDir);
  let real: string;
  try {
    real = await fsp.realpath(ancestor);
  } catch {
    // Ancestor vanished between lstat and realpath (benign race on a directory nobody else
    // should be touching); treat as safe and let the actual mkdir/open below fail loudly if
    // something is really wrong.
    return;
  }
  if (
    real !== resolvedRoot &&
    !real.startsWith(withTrailingSep(resolvedRoot))
  ) {
    throw new StoragePathError(
      "Storage path escapes the storage root via a symlink.",
    );
  }
}

/** Same check for a file expected to already exist (read/delete), including the file itself. */
async function assertFileWithinRoot(
  candidate: string,
  resolvedRoot: string,
): Promise<string> {
  await assertNoSymlinkEscape(path.dirname(candidate), resolvedRoot);

  let real: string;
  try {
    real = await fsp.realpath(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StorageNotFoundError("Storage object not found.");
    }
    throw error;
  }
  if (
    real !== resolvedRoot &&
    !real.startsWith(withTrailingSep(resolvedRoot))
  ) {
    throw new StoragePathError(
      "Storage path escapes the storage root via a symlink.",
    );
  }
  return real;
}

// ---------------------------------------------------------------------------
// Upload tokens — the local stand-in for an S3 presigned URL's signature
// ---------------------------------------------------------------------------

const UPLOAD_TOKEN_INFO = "taskdesk:storage:filesystem-upload-token:v1";

function deriveUploadTokenKey(): Buffer {
  const authSecret = getAuthSecretEnv();
  if (!authSecret) {
    throw new Error(
      "TASKDESK_AUTH_SECRET is required to mint filesystem upload tokens.",
    );
  }
  return Buffer.from(
    crypto.hkdfSync(
      "sha256",
      Buffer.from(authSecret, "utf8"),
      Buffer.alloc(0),
      Buffer.from(UPLOAD_TOKEN_INFO, "utf8"),
      32,
    ),
  );
}

function signUploadToken(key: string, expires: number): string {
  const hmac = crypto.createHmac("sha256", deriveUploadTokenKey());
  hmac.update(`${key}\n${expires}`);
  return hmac.digest("base64url");
}

/** Exported for tests only — mints a token for an arbitrary key, including a malicious one,
 * so the path-safety layer in `writeUploadedObject` can be tested independently of the token
 * layer (a cryptographically valid token for a traversal key must still be refused). No
 * application code calls this directly; `createTaskImageUploadUrl` is the real entry point. */
export function signUploadTokenForTests(key: string, expires: number): string {
  return signUploadToken(key, expires);
}

export function verifyUploadToken(
  key: string,
  expires: number,
  token: string,
): boolean {
  let expected: string;
  try {
    expected = signUploadToken(key, expires);
  } catch {
    return false;
  }
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(token, "utf8");
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// ---------------------------------------------------------------------------
// The driver surface s3.ts also exposes
// ---------------------------------------------------------------------------

export async function createTaskImageUploadUrl(
  context: TaskImageUploadContext,
): Promise<TaskImageUploadUrl> {
  const config = await assertStorageConfigured();
  const key = buildObjectKey(context);
  const expires = Math.floor(Date.now() / 1000) + config.uploadUrlTtlSeconds;
  const token = signUploadToken(key, expires);

  // normalizeApiServerUrl trims a trailing slash and ensures exactly one `/api` suffix,
  // regardless of whether context.apiBaseUrl already carries one — idempotent, so it is safe
  // to apply here even if a future caller starts pre-normalizing its input too. No env
  // fallback here on purpose: the one real caller (task/index.ts) always supplies
  // apiBaseUrl, computed from its own origin; check:env attributes an environment read to
  // the literal file it appears in, and this file has no baselined allowance to read the
  // same origin variable task/index.ts already does.
  const base = normalizeApiServerUrl(
    context.apiBaseUrl || "http://localhost:1337",
  );

  const query = new URLSearchParams({
    key,
    expires: String(expires),
    token,
  });

  return {
    key,
    uploadUrl: `${base}/storage/filesystem-upload?${query.toString()}`,
    headers: {
      "Content-Type": context.contentType,
    },
  };
}

/**
 * Writes the request body to disk at `key`, after verifying the upload token and re-deriving
 * path safety independently. Called from the `PUT /api/storage/filesystem-upload` route
 * registered in `index.ts`.
 */
export async function writeUploadedObject(params: {
  key: string;
  expires: string;
  token: string;
  body: ReadableStream<Uint8Array> | null;
}): Promise<void> {
  const expiresNum = Number.parseInt(params.expires, 10);
  if (!Number.isFinite(expiresNum)) {
    throw new StoragePathError("Invalid or missing upload expiry.");
  }
  if (Math.floor(Date.now() / 1000) > expiresNum) {
    throw new StoragePathError("Upload URL has expired.");
  }
  if (!verifyUploadToken(params.key, expiresNum, params.token)) {
    throw new StoragePathError("Invalid or missing upload token.");
  }
  if (!params.body) {
    throw new StoragePathError("Missing upload body.");
  }

  const config = getFilesystemConfig();
  const candidate = resolveWithinRoot(config.root, params.key);
  const dir = path.dirname(candidate);

  await assertNoSymlinkEscape(dir, config.root);
  await fsp.mkdir(dir, { recursive: true });
  // Re-check after mkdir: cheap, and it catches the (very unlikely) case where the directory
  // creation itself walked through something unexpected.
  await assertNoSymlinkEscape(dir, config.root);

  await writeStreamToFile(params.body, candidate, config.maxUploadBytes);
}

async function writeStreamToFile(
  webStream: ReadableStream<Uint8Array>,
  destPath: string,
  maxBytes: number,
): Promise<void> {
  let total = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxBytes) {
        callback(
          new StoragePathError(
            `Upload exceeds the maximum upload size of ${Math.floor(maxBytes / (1024 * 1024))}MB.`,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });

  // Node's Readable.fromWeb expects node:stream/web's ReadableStream; Hono hands us the DOM
  // lib's ReadableStream. Both are the same Fetch API standard stream at runtime — only the
  // TypeScript lib declarations disagree — so this goes through `unknown` rather than `any`.
  const nodeStream = Readable.fromWeb(
    webStream as unknown as NodeWebReadableStream<Uint8Array>,
  );

  let fileHandle: FileHandle | undefined;
  try {
    fileHandle = await fsp.open(
      destPath,
      // O_NOFOLLOW refuses to open through a symlink planted at the exact target path — the
      // one case the ancestor-realpath check above does not cover, because it only resolves
      // directories, not the final file component.
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_TRUNC |
        fs.constants.O_NOFOLLOW,
      0o640,
    );
    const writeStream = fileHandle.createWriteStream();
    await pipeline(nodeStream, limiter, writeStream);
  } catch (error) {
    await fsp.unlink(destPath).catch(() => {});
    if ((error as NodeJS.ErrnoException)?.code === "ELOOP") {
      throw new StoragePathError(
        "Storage path escapes the storage root via a symlink.",
      );
    }
    throw error;
  } finally {
    await fileHandle?.close().catch(() => {});
  }
}

export async function getPrivateObject(key: string): Promise<AssetObject> {
  const config = getFilesystemConfig();
  const candidate = resolveWithinRoot(config.root, key);
  await assertFileWithinRoot(candidate, config.root);

  const stat = await fsp.stat(candidate).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StorageNotFoundError("Storage object not found.");
    }
    throw error;
  });
  if (!stat.isFile()) {
    throw new StorageNotFoundError("Storage object not found.");
  }

  const nodeStream = fs.createReadStream(candidate);
  const body = Readable.toWeb(nodeStream);

  return {
    body,
    // No content-type is persisted alongside the bytes: the caller (GET /api/asset/{id} in
    // index.ts) already falls back to the database-stored `asset.mimeType` whenever this is
    // undefined, so there is no behavioural gap, and it avoids a sidecar-metadata file for
    // every object.
    contentType: undefined,
    contentLength: stat.size,
    etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    lastModified: stat.mtime,
  };
}

export async function deleteObject(key: string): Promise<void> {
  const config = getFilesystemConfig();
  const candidate = resolveWithinRoot(config.root, key);

  let real: string;
  try {
    real = await assertFileWithinRoot(candidate, config.root);
  } catch (error) {
    if (error instanceof StorageNotFoundError) {
      // Deleting an object that is already gone is a no-op, matching S3's DeleteObject
      // semantics (and cleanup-assets.ts's Promise.allSettled usage relies on this).
      return;
    }
    throw error;
  }

  await fsp.unlink(real).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  });
}
