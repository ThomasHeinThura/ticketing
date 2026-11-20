/**
 * PTM-06: the backend fingerprint stored in `attachment_object_gc.storage_driver` is a named,
 * canonical JSON tuple digest. It is a CHANGE DETECTOR (it never claims to identify a volume or
 * bucket) and it never includes credentials.
 */
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getStorageBackendFingerprint,
  getStorageDriver,
} from "../../../apps/api/src/storage";

const saved = { ...process.env };
beforeEach(() => {
  for (const name of [
    "TASKDESK_STORAGE_DRIVER",
    "TASKDESK_STORAGE_FILESYSTEM_ROOT",
    "TASKDESK_ROLE",
    "S3_ENDPOINT",
    "S3_BUCKET",
    "S3_REGION",
    "S3_FORCE_PATH_STYLE",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ])
    delete process.env[name];
});
afterEach(() => {
  process.env = { ...saved };
});

const useS3 = (overrides: Record<string, string> = {}) => {
  Object.assign(process.env, {
    TASKDESK_STORAGE_DRIVER: "s3",
    S3_ENDPOINT: "https://s3.example.com",
    S3_BUCKET: "bucket",
    ...overrides,
  });
};
const useFilesystem = (root: string, role?: string) => {
  process.env.TASKDESK_STORAGE_DRIVER = "filesystem";
  process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
  if (role) process.env.TASKDESK_ROLE = role;
};

describe("getStorageBackendFingerprint", () => {
  it("has the stored shape <driver>:<16 hex>", () => {
    useFilesystem("/data/attachments");
    expect(getStorageBackendFingerprint()).toMatch(/^filesystem:[0-9a-f]{16}$/);
    useS3();
    expect(getStorageBackendFingerprint()).toMatch(/^s3:[0-9a-f]{16}$/);
  });

  it("S3: host case, a trailing slash and an unset or default region fingerprint equal", () => {
    useS3({ S3_ENDPOINT: "https://S3.Example.com/" });
    const a = getStorageBackendFingerprint();
    useS3({ S3_ENDPOINT: "https://s3.example.com" });
    const b = getStorageBackendFingerprint();
    useS3({ S3_ENDPOINT: "https://s3.example.com", S3_REGION: "us-east-1" });
    const c = getStorageBackendFingerprint();
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("S3: the default port is dropped but another port, path, bucket, region and path style all differ", () => {
    useS3({ S3_ENDPOINT: "https://s3.example.com:443" });
    const base = getStorageBackendFingerprint();
    useS3();
    expect(getStorageBackendFingerprint()).toBe(base);
    const overrides: Record<string, string>[] = [
      { S3_ENDPOINT: "https://s3.example.com:9000" },
      { S3_ENDPOINT: "https://s3.example.com/minio" },
      { S3_BUCKET: "other" },
      { S3_REGION: "eu-west-1" },
      { S3_FORCE_PATH_STYLE: "false" },
    ];
    const different = overrides.map((override) => {
      useS3(override);
      return getStorageBackendFingerprint();
    });
    for (const value of different) expect(value).not.toBe(base);
    expect(new Set(different).size).toBe(different.length);
  });

  it("S3: credentials never change it", () => {
    useS3({ S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "one" });
    const first = getStorageBackendFingerprint();
    useS3({ S3_ACCESS_KEY_ID: "b", S3_SECRET_ACCESS_KEY: "two" });
    expect(getStorageBackendFingerprint()).toBe(first);
  });

  it("filesystem: a relative root equals its absolute resolution; another root differs", () => {
    useFilesystem("relative/root");
    const relative = getStorageBackendFingerprint();
    useFilesystem(path.resolve("relative/root"));
    expect(getStorageBackendFingerprint()).toBe(relative);
    useFilesystem("/data/other");
    expect(getStorageBackendFingerprint()).not.toBe(relative);
  });

  it("filesystem: the configured role is part of the tuple (unset equals all; web, jobs and all differ)", () => {
    useFilesystem("/data/attachments");
    const unset = getStorageBackendFingerprint();
    useFilesystem("/data/attachments", "all");
    expect(getStorageBackendFingerprint()).toBe(unset);
    useFilesystem("/data/attachments", "web");
    const web = getStorageBackendFingerprint();
    useFilesystem("/data/attachments", "jobs");
    const jobs = getStorageBackendFingerprint();
    expect(new Set([unset, web, jobs]).size).toBe(3);
  });

  it("S3 does not depend on the role", () => {
    useS3();
    const base = getStorageBackendFingerprint();
    process.env.TASKDESK_ROLE = "web";
    expect(getStorageBackendFingerprint()).toBe(base);
  });

  it("an unconfigured S3 driver throws from the fingerprint only when S3 is selected", () => {
    process.env.TASKDESK_STORAGE_DRIVER = "s3";
    expect(() => getStorageBackendFingerprint()).toThrow();
    useFilesystem("/data/attachments");
    expect(getStorageDriver()).toBe("filesystem");
    expect(() => getStorageBackendFingerprint()).not.toThrow();
  });

  it("never exposes raw configuration in the value", () => {
    useS3({ S3_BUCKET: "very-secret-bucket-name" });
    expect(getStorageBackendFingerprint()).not.toContain("secret");
    useFilesystem("/very/private/root");
    expect(getStorageBackendFingerprint()).not.toContain("private");
  });
});
