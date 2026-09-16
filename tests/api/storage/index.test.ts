import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTaskImageUploadUrl,
  deleteStorageObject,
  getPrivateObject,
  getStorageDriver,
  validateTaskAssetUploadInput,
} from "../../../apps/api/src/storage/index";

/**
 * The selector reads `TASKDESK_STORAGE_DRIVER` fresh on every call rather than caching it, so
 * these tests exercise that directly: flip the env var mid-suite and confirm the observable
 * behaviour actually changes, not just that a driver-name string changes.
 */
describe("storage driver selector", () => {
  let root: string;
  const trackedKeys = [
    "TASKDESK_STORAGE_DRIVER",
    "TASKDESK_STORAGE_FILESYSTEM_ROOT",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_MAX_IMAGE_UPLOAD_BYTES",
  ] as const;
  const original: Partial<Record<(typeof trackedKeys)[number], string>> = {};

  beforeEach(async () => {
    for (const key of trackedKeys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-storage-selector-"));
    process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
  });

  afterEach(async () => {
    for (const key of trackedKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    await rm(root, { recursive: true, force: true });
  });

  it("defaults to filesystem when TASKDESK_STORAGE_DRIVER is unset", () => {
    expect(getStorageDriver()).toBe("filesystem");
  });

  it("selects filesystem or s3 case-insensitively", () => {
    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    expect(getStorageDriver()).toBe("s3");
    process.env.TASKDESK_STORAGE_DRIVER = "S3";
    expect(getStorageDriver()).toBe("s3");
    process.env.TASKDESK_STORAGE_DRIVER = "Filesystem";
    expect(getStorageDriver()).toBe("filesystem");
  });

  it("throws on an unrecognized driver name rather than silently defaulting", () => {
    process.env.TASKDESK_STORAGE_DRIVER = "azure-blob";
    expect(() => getStorageDriver()).toThrow(/TASKDESK_STORAGE_DRIVER/);
  });

  it("switching the driver actually changes which upload-size ceiling applies", () => {
    process.env.S3_MAX_IMAGE_UPLOAD_BYTES = "1048576"; // 1MB, s3-only

    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    expect(() =>
      validateTaskAssetUploadInput("image/png", 2 * 1024 * 1024),
    ).toThrow("Upload exceeds the maximum upload size of 1MB.");

    // Same env, only the driver flips: filesystem does not read S3_MAX_IMAGE_UPLOAD_BYTES at
    // all, so the same 2MB size is under its own (10MB) default and must not throw.
    process.env.TASKDESK_STORAGE_DRIVER = "filesystem";
    expect(() =>
      validateTaskAssetUploadInput("image/png", 2 * 1024 * 1024),
    ).not.toThrow();
  });

  it("switching the driver actually changes which implementation mints the upload URL", async () => {
    const context = {
      workspaceId: "ws1",
      projectId: "p1",
      taskId: "t1",
      surface: "description" as const,
      filename: "photo.png",
      contentType: "image/png",
    };

    process.env.TASKDESK_STORAGE_DRIVER = "filesystem";
    const filesystemUpload = await createTaskImageUploadUrl(context);
    expect(filesystemUpload.uploadUrl).toContain("/storage/filesystem-upload");
    expect(filesystemUpload.uploadUrl).not.toContain("X-Amz-Signature");

    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    process.env.S3_ENDPOINT = "https://storage.example.test";
    process.env.S3_BUCKET = "taskdesk";
    process.env.S3_ACCESS_KEY_ID = "test-access-key";
    process.env.S3_SECRET_ACCESS_KEY = "test-secret-key";
    const s3Upload = await createTaskImageUploadUrl(context);
    expect(s3Upload.uploadUrl).toContain("X-Amz-Signature");
    expect(s3Upload.uploadUrl).not.toContain("/storage/filesystem-upload");
  });

  it("switching the driver actually changes which implementation getPrivateObject/deleteStorageObject reach", async () => {
    process.env.TASKDESK_STORAGE_DRIVER = "filesystem";
    const context = {
      workspaceId: "ws1",
      projectId: "p1",
      taskId: "t1",
      surface: "description" as const,
      filename: "photo.png",
      contentType: "image/png",
    };
    const upload = await createTaskImageUploadUrl(context);

    // Written directly through the filesystem driver's own write path (exercised end-to-end
    // in filesystem.test.ts); here the point is only that the selector's read/delete reach
    // the same file.
    const { writeUploadedObject } = await import(
      "../../../apps/api/src/storage/filesystem"
    );
    const url = new URL(upload.uploadUrl);
    await writeUploadedObject({
      key: upload.key,
      expires: url.searchParams.get("expires") as string,
      token: url.searchParams.get("token") as string,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hi"));
          controller.close();
        },
      }),
    });

    const object = await getPrivateObject(upload.key);
    expect(object.contentLength).toBe(2);

    await deleteStorageObject(upload.key);
    await expect(getPrivateObject(upload.key)).rejects.toThrow();

    // Now flip to s3 with no S3 configuration at all: getPrivateObject must reach s3.ts's own
    // "not configured" failure, proving the selector actually dispatched there instead of
    // silently continuing to use the filesystem driver.
    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    await expect(getPrivateObject(upload.key)).rejects.toThrow(
      /S3 uploads are not configured/,
    );
  });
});
