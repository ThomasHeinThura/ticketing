import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertStorageConfigured,
  assertTaskImageKeyMatchesContext,
  createTaskImageUploadUrl,
  DEFAULT_ROOT,
  deleteObject,
  getPrivateObject,
  StorageNotFoundError,
  StoragePathError,
  signUploadTokenForTests,
  validateTaskAssetUploadInput,
  writeUploadedObject,
} from "../../../apps/api/src/storage/filesystem";

function bodyFrom(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function bodyOfBytes(totalBytes: number): ReadableStream<Uint8Array> {
  const chunkSize = 1024 * 1024;
  const chunk = new Uint8Array(chunkSize);
  let remaining = totalBytes;
  return new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const size = Math.min(chunkSize, remaining);
      controller.enqueue(size === chunkSize ? chunk : chunk.slice(0, size));
      remaining -= size;
    },
  });
}

async function readAll(body: unknown): Promise<string> {
  const stream = body as ReadableStream<Uint8Array>;
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(
    "utf8",
  );
}

describe("filesystem storage driver", () => {
  let root: string;
  const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
  const originalAuthSecret = process.env.TASKDESK_AUTH_SECRET;

  const context = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    taskId: "task-1",
    surface: "description" as const,
  };

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-fs-storage-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
  });

  afterEach(async () => {
    if (originalRoot === undefined) {
      delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    } else {
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
    }
    if (originalAuthSecret === undefined) {
      delete process.env.TASKDESK_AUTH_SECRET;
    } else {
      process.env.TASKDESK_AUTH_SECRET = originalAuthSecret;
    }
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips a normal upload: presign, write, read, delete", async () => {
    const upload = await createTaskImageUploadUrl({
      ...context,
      filename: "photo.png",
      contentType: "image/png",
    });

    const url = new URL(upload.uploadUrl);
    expect(url.pathname).toBe("/api/storage/filesystem-upload");
    expect(url.searchParams.get("key")).toBe(upload.key);
    const expires = url.searchParams.get("expires");
    const token = url.searchParams.get("token");
    expect(expires).toBeTruthy();
    expect(token).toBeTruthy();

    await writeUploadedObject({
      key: upload.key,
      expires: expires as string,
      token: token as string,
      body: bodyFrom("hello world"),
    });

    const object = await getPrivateObject(upload.key);
    expect(await readAll(object.body)).toBe("hello world");
    expect(object.contentLength).toBe(11);
    expect(object.contentType).toBeUndefined();
    expect(object.etag).toBeTruthy();
    expect(object.lastModified).toBeInstanceOf(Date);

    await deleteObject(upload.key);
    await expect(getPrivateObject(upload.key)).rejects.toThrow(
      StorageNotFoundError,
    );

    // Deleting an already-deleted object is a no-op — matches S3's DeleteObject semantics,
    // which cleanup-assets.ts's Promise.allSettled usage relies on.
    await expect(deleteObject(upload.key)).resolves.toBeUndefined();
  });

  it("overwrites an existing key on re-upload, matching a PUT's semantics", async () => {
    const upload = await createTaskImageUploadUrl({
      ...context,
      filename: "photo.png",
      contentType: "image/png",
    });
    const url = new URL(upload.uploadUrl);
    const expires = url.searchParams.get("expires") as string;
    const token = url.searchParams.get("token") as string;

    await writeUploadedObject({
      key: upload.key,
      expires,
      token,
      body: bodyFrom("first version, much longer than the second"),
    });
    await writeUploadedObject({
      key: upload.key,
      expires,
      token,
      body: bodyFrom("second"),
    });

    const object = await getPrivateObject(upload.key);
    expect(await readAll(object.body)).toBe("second");
  });

  it("assertTaskImageKeyMatchesContext rejects traversal past the prefix", () => {
    const prefix = "workspace/ws1/project/p1/task/t1/descriptions";
    const ctx = {
      workspaceId: "ws1",
      projectId: "p1",
      taskId: "t1",
      surface: "description" as const,
    };

    expect(
      assertTaskImageKeyMatchesContext(`${prefix}/image-1-abc.png`, ctx),
    ).toBe(true);

    for (const suffix of [
      "../../../../../../workspace/victim/secret.png",
      "nested/deeper.png",
      "..%2Fescape.png",
      ".hidden",
      "back\\slash.png",
    ]) {
      expect(assertTaskImageKeyMatchesContext(`${prefix}/${suffix}`, ctx)).toBe(
        false,
      );
    }
  });

  it("refuses a traversal key on read, write and delete, even with a validly-signed token", async () => {
    const maliciousKeys = [
      "../outside.png",
      "../../etc/passwd",
      "workspace/../../outside.png",
      "/etc/passwd",
      "a/b/../../../c",
    ];

    for (const key of maliciousKeys) {
      await expect(getPrivateObject(key)).rejects.toThrow(StoragePathError);
      await expect(deleteObject(key)).rejects.toThrow(StoragePathError);

      const expires = Math.floor(Date.now() / 1000) + 300;
      // A cryptographically valid token for this exact malicious key: proves the path-safety
      // layer is what refuses it, independent of the token layer.
      const token = signUploadTokenForTests(key, expires);
      await expect(
        writeUploadedObject({
          key,
          expires: String(expires),
          token,
          body: bodyFrom("evil"),
        }),
      ).rejects.toThrow(StoragePathError);
    }

    // Nothing actually escaped onto disk next to the storage root.
    await expect(
      readFile(path.join(path.dirname(root), "outside.png")),
    ).rejects.toThrow();
  });

  it("refuses a key containing a null byte or a backslash", async () => {
    // Built via String.fromCharCode rather than a literal escape sequence in the source, so
    // the committed file never carries a raw NUL byte for a diff/editor/linter to choke on.
    const keyWithNullByte = `workspace/x${String.fromCharCode(0)}.png`;
    await expect(getPrivateObject(keyWithNullByte)).rejects.toThrow(
      StoragePathError,
    );
    await expect(getPrivateObject("workspace\\x.png")).rejects.toThrow(
      StoragePathError,
    );
  });

  it("refuses to write through a symlink planted inside the storage root", async () => {
    const outsideDir = await mkdtemp(
      path.join(tmpdir(), "taskdesk-fs-outside-"),
    );
    try {
      await symlink(outsideDir, path.join(root, "escape"), "dir");

      const key = "escape/evil.png";
      const expires = Math.floor(Date.now() / 1000) + 300;
      const token = signUploadTokenForTests(key, expires);

      await expect(
        writeUploadedObject({
          key,
          expires: String(expires),
          token,
          body: bodyFrom("evil"),
        }),
      ).rejects.toThrow(StoragePathError);

      await expect(
        readFile(path.join(outsideDir, "evil.png")),
      ).rejects.toThrow();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses to read through a symlink planted inside the storage root", async () => {
    const outsideDir = await mkdtemp(
      path.join(tmpdir(), "taskdesk-fs-outside-"),
    );
    try {
      await writeFile(path.join(outsideDir, "secret.png"), "top secret");
      await symlink(outsideDir, path.join(root, "escape-read"), "dir");

      await expect(getPrivateObject("escape-read/secret.png")).rejects.toThrow(
        StoragePathError,
      );
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("refuses to delete through a symlink planted inside the storage root", async () => {
    const outsideDir = await mkdtemp(
      path.join(tmpdir(), "taskdesk-fs-outside-"),
    );
    try {
      await writeFile(path.join(outsideDir, "secret.png"), "top secret");
      await symlink(outsideDir, path.join(root, "escape-delete"), "dir");

      await expect(deleteObject("escape-delete/secret.png")).rejects.toThrow(
        StoragePathError,
      );
      // Confirm it is really still there — "refused" and not "silently no-op'd".
      await expect(
        readFile(path.join(outsideDir, "secret.png")),
      ).resolves.toBeTruthy();
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects an expired upload URL", async () => {
    const key = "workspace/ws1/project/p1/task/t1/descriptions/img-1.png";
    const expires = Math.floor(Date.now() / 1000) - 10;
    const token = signUploadTokenForTests(key, expires);

    await expect(
      writeUploadedObject({
        key,
        expires: String(expires),
        token,
        body: bodyFrom("x"),
      }),
    ).rejects.toThrow(StoragePathError);
  });

  it("rejects a forged upload token", async () => {
    const key = "workspace/ws1/project/p1/task/t1/descriptions/img-1.png";
    const expires = Math.floor(Date.now() / 1000) + 300;

    await expect(
      writeUploadedObject({
        key,
        expires: String(expires),
        token: "not-a-real-token",
        body: bodyFrom("x"),
      }),
    ).rejects.toThrow(StoragePathError);
  });

  it("rejects a token minted for a different key", async () => {
    const expires = Math.floor(Date.now() / 1000) + 300;
    const tokenForOtherKey = signUploadTokenForTests(
      "workspace/ws1/project/p1/task/t1/descriptions/other.png",
      expires,
    );

    await expect(
      writeUploadedObject({
        key: "workspace/ws1/project/p1/task/t1/descriptions/img-1.png",
        expires: String(expires),
        token: tokenForOtherKey,
        body: bodyFrom("x"),
      }),
    ).rejects.toThrow(StoragePathError);
  });

  it("refuses an upload larger than the configured maximum, and cleans up the partial file", async () => {
    const key = "workspace/ws1/project/p1/task/t1/descriptions/big.png";
    const expires = Math.floor(Date.now() / 1000) + 300;
    const token = signUploadTokenForTests(key, expires);

    await expect(
      writeUploadedObject({
        key,
        expires: String(expires),
        token,
        body: bodyOfBytes(11 * 1024 * 1024), // default max is 10MB
      }),
    ).rejects.toThrow(/maximum upload size/);

    await expect(getPrivateObject(key)).rejects.toThrow(StorageNotFoundError);
  });

  it("validateTaskAssetUploadInput enforces the default 10MB ceiling", () => {
    expect(() => validateTaskAssetUploadInput("image/png", 0)).toThrow(
      "Upload size must be greater than zero.",
    );
    expect(() => validateTaskAssetUploadInput("", 10)).toThrow(
      "A valid content type is required.",
    );
    expect(() =>
      validateTaskAssetUploadInput("image/png", 11 * 1024 * 1024),
    ).toThrow("Upload exceeds the maximum upload size of 10MB.");
    expect(() => validateTaskAssetUploadInput("image/png", 512)).not.toThrow();
  });

  it("assertStorageConfigured creates the configured root when it does not exist yet", async () => {
    const freshRoot = path.join(root, "nested", "does-not-exist-yet");
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = freshRoot;

    const config = await assertStorageConfigured();
    expect(config.root).toBe(freshRoot);
    expect((await stat(freshRoot)).isDirectory()).toBe(true);
  });

  it("defaults the storage root to the Dockerfile-created directory", () => {
    expect(DEFAULT_ROOT).toBe("/app/data/attachments");
  });

  it("falls back to the localhost default when no apiBaseUrl is given", async () => {
    // This module deliberately does not read an origin-related environment variable itself
    // (see the comment in createTaskImageUploadUrl) — the one real caller, the task router,
    // always supplies apiBaseUrl. Absent that, this hardcoded default is what applies.
    const upload = await createTaskImageUploadUrl({
      ...context,
      filename: "photo.png",
      contentType: "image/png",
    });
    expect(
      upload.uploadUrl.startsWith(
        "http://localhost:1337/api/storage/filesystem-upload?",
      ),
    ).toBe(true);
  });

  it("mints an upload URL from an explicit apiBaseUrl when one is given", async () => {
    const upload = await createTaskImageUploadUrl({
      ...context,
      filename: "photo.png",
      contentType: "image/png",
      apiBaseUrl: "https://ticket.example.com/api",
    });
    expect(
      upload.uploadUrl.startsWith(
        "https://ticket.example.com/api/storage/filesystem-upload?",
      ),
    ).toBe(true);
  });

  it("requires TASKDESK_AUTH_SECRET to mint an upload token", async () => {
    delete process.env.TASKDESK_AUTH_SECRET;

    await expect(
      createTaskImageUploadUrl({
        ...context,
        filename: "photo.png",
        contentType: "image/png",
      }),
    ).rejects.toThrow(/TASKDESK_AUTH_SECRET/);
  });
});
