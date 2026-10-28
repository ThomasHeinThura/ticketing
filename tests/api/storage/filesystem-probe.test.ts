import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteStorageProbeObject,
  getStorageProbeReadiness,
  readStorageProbeObject,
  writeStorageProbeObject,
} from "../../../apps/api/src/storage/filesystem";

describe("filesystem storage probe adapter", () => {
  let root: string;
  const envName = "TASKDESK_STORAGE_FILESYSTEM_ROOT";
  const previous = process.env[envName];

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "taskdesk-storage-probe-test-"));
    process.env[envName] = root;
  });

  afterEach(async () => {
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
    await rm(root, { recursive: true, force: true });
  });

  it("round-trips only the reserved key and removes the exact object", async () => {
    const key = "taskdesk-storage-probe-e21a9b3f-8a77-42be-9864-63d35c925735";
    const bytes = Buffer.from("fixed probe bytes");
    const controller = new AbortController();
    await writeStorageProbeObject(key, bytes, controller.signal);
    await expect(
      readStorageProbeObject(key, bytes.byteLength, controller.signal),
    ).resolves.toEqual(bytes);
    await deleteStorageProbeObject(key, controller.signal);
    await expect(
      readStorageProbeObject(key, bytes.byteLength, controller.signal),
    ).rejects.toThrow();
  });

  it("does not create a missing storage root during readiness inspection", async () => {
    const missing = path.join(root, "missing");
    process.env[envName] = missing;
    await expect(getStorageProbeReadiness()).resolves.toBe("unavailable");
    await expect(rm(missing)).rejects.toThrow();
  });

  it("does not replace an existing reserved object", async () => {
    const key = "taskdesk-storage-probe-e21a9b3f-8a77-42be-9864-63d35c925735";
    const originalBytes = Buffer.from("existing object");
    await writeFile(path.join(root, key), originalBytes, { flag: "wx" });
    await expect(
      writeStorageProbeObject(
        key,
        Buffer.from("probe"),
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    await expect(readFile(path.join(root, key))).resolves.toEqual(
      originalBytes,
    );
  });
});
