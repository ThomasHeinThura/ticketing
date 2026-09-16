import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { signUploadTokenForTests } from "../../apps/api/src/storage/filesystem";

/**
 * HTTP-level coverage for `PUT /api/storage/filesystem-upload`.
 *
 * Every existing negative test for this driver (`tests/api/storage/filesystem.test.ts`) calls
 * `writeUploadedObject` and friends directly, bypassing the actual route entirely — so the
 * route's placement above the session-auth guard (it is genuinely reachable with no session at
 * all), its Zod query-parameter contract, its HTTP status-code mapping, and the
 * `TASKDESK_STORAGE_DRIVER=s3` fallback are untested at the HTTP layer. This file drives the
 * real Hono app (`createApp()`) exactly the way a browser's direct PUT would.
 */
describe("API integration: PUT /api/storage/filesystem-upload", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;

  const prefix = "workspace/ws1/project/p1/task/t1/descriptions";

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-fs-upload-route-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
    delete process.env.TASKDESK_STORAGE_DRIVER;
  });

  afterEach(async () => {
    if (originalRoot === undefined) {
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    } else {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    }
    if (originalDriver === undefined) {
      delete process.env.TASKDESK_STORAGE_DRIVER;
    } else {
      process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
    }
    await rm(root, { recursive: true, force: true });
  });

  function validQuery(key: string, ttlSeconds = 300) {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const token = signUploadTokenForTests(key, expires);
    return { key, expires: String(expires), token };
  }

  function uploadUrl(query: Record<string, string>) {
    return `/api/storage/filesystem-upload?${new URLSearchParams(query).toString()}`;
  }

  it("accepts an UNAUTHENTICATED PUT with a valid, freshly-minted token and lands the file on disk", async () => {
    const { app } = createApp();
    const key = `${prefix}/image-1.png`;
    const { expires, token } = validQuery(key);

    const response = await app.request(uploadUrl({ key, expires, token }), {
      method: "PUT",
      // Deliberately no cookie, no Authorization header, no x-api-key: this is the whole
      // point of the test. The route is reachable with no session at all.
      headers: { "content-type": "application/octet-stream" },
      body: new TextEncoder().encode("hello world"),
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");

    const onDisk = await readFile(path.join(root, key));
    expect(onDisk.toString("utf8")).toBe("hello world");
  });

  it("refuses a forged upload token with a 4xx, and writes no file", async () => {
    const { app } = createApp();
    const key = `${prefix}/forged.png`;
    const expires = String(Math.floor(Date.now() / 1000) + 300);

    const response = await app.request(
      uploadUrl({ key, expires, token: "not-a-real-token" }),
      { method: "PUT", body: new TextEncoder().encode("evil") },
    );

    expect(response.status).toBe(400);
    await expect(stat(path.join(root, key))).rejects.toThrow();
  });

  it("refuses a truncated/malformed token with a 4xx, and writes no file", async () => {
    const { app } = createApp();
    const key = `${prefix}/malformed.png`;
    const { expires, token } = validQuery(key);
    const truncated = token.slice(0, Math.max(1, token.length - 4));

    const response = await app.request(
      uploadUrl({ key, expires, token: truncated }),
      { method: "PUT", body: new TextEncoder().encode("evil") },
    );

    expect(response.status).toBe(400);
    await expect(stat(path.join(root, key))).rejects.toThrow();
  });

  it("refuses a validly-signed but EXPIRED token with a 4xx, and writes no file", async () => {
    const { app } = createApp();
    const key = `${prefix}/expired.png`;
    const expiredAt = Math.floor(Date.now() / 1000) - 10;
    const token = signUploadTokenForTests(key, expiredAt);

    const response = await app.request(
      uploadUrl({ key, expires: String(expiredAt), token }),
      { method: "PUT", body: new TextEncoder().encode("evil") },
    );

    expect(response.status).toBe(400);
    await expect(stat(path.join(root, key))).rejects.toThrow();
  });

  it("404s when the s3 driver is active, since s3 never issues a URL pointing here", async () => {
    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    const { app } = createApp();
    const key = `${prefix}/whatever.png`;
    const { expires, token } = validQuery(key);

    const response = await app.request(uploadUrl({ key, expires, token }), {
      method: "PUT",
      body: new TextEncoder().encode("x"),
    });

    expect(response.status).toBe(404);
    // Confirm the s3-driver 404 really did nothing to the filesystem root either.
    await expect(stat(path.join(root, key))).rejects.toThrow();
  });

  it("refuses a traversal-shaped key with a 400 even with a VALIDLY SIGNED token, and writes nothing outside the storage root", async () => {
    const { app } = createApp();
    const key = "../../etc/passwd";
    const { expires, token } = validQuery(key);

    const response = await app.request(uploadUrl({ key, expires, token }), {
      method: "PUT",
      body: new TextEncoder().encode("evil"),
    });

    expect(response.status).toBe(400);

    // The real /etc/passwd on the test host must be untouched.
    const passwd = await readFile("/etc/passwd", "utf8");
    expect(passwd).not.toContain("evil");

    // And nothing landed inside the configured root either (mkdir/open never ran —
    // assertSafeRelativeKey throws before any I/O).
    await expect(readdir(root)).resolves.toEqual([]);
  });

  it("maps an unexpected filesystem error to a generic message, never the raw error text", async () => {
    const { app } = createApp();
    // Upload a normal file first...
    const clashKey = `${prefix}/leaf-clash`;
    {
      const { expires, token } = validQuery(clashKey);
      const first = await app.request(
        uploadUrl({ key: clashKey, expires, token }),
        {
          method: "PUT",
          body: new TextEncoder().encode("i am a file, not a directory"),
        },
      );
      expect(first.status).toBe(204);
    }

    // ...then try to upload a second object nested "inside" that file's path — mkdir(dir,
    // {recursive:true}) fails with a raw ENOTDIR-style Node fs error, not a StoragePathError.
    const nestedKey = `${clashKey}/nested.png`;
    const { expires, token } = validQuery(nestedKey);
    const response = await app.request(
      uploadUrl({ key: nestedKey, expires, token }),
      { method: "PUT", body: new TextEncoder().encode("evil") },
    );

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toBe("Upload failed.");
    // The generic message must not leak the raw fs error or the server's absolute storage
    // root path.
    expect(body).not.toContain(root);
    expect(body.toLowerCase()).not.toContain("enotdir");
    expect(body.toLowerCase()).not.toContain("mkdir");
  });
});
