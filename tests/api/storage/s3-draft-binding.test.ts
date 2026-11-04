import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalS3DraftRequest } from "../../../apps/api/src/storage/s3-draft-binding";
import type { S3DraftWrite } from "../../../apps/api/src/storage/s3-draft-schema";

const request: S3DraftWrite = {
  version: 0,
  config: {
    connector: "bundled_seaweedfs",
    forcePathStyle: true,
    publicBaseUrl: "https://files.example.test",
    region: "us-east-1",
    bucket: "draft-bucket",
    keyPrefix: "diagnostics/",
    maxImageUploadBytes: 10_485_760,
    presignTtlSeconds: 300,
  },
};
afterEach(() => vi.unstubAllEnvs());
describe("S3 draft proof canonicalization", () => {
  it("binds exact versions, destinations, credential intent and supplied values", () => {
    vi.stubEnv("TASKDESK_AUTH_SECRET", "a".repeat(64));
    const keep = canonicalS3DraftRequest(request);
    expect(keep.credentials.accessKeyId).toEqual({ intent: "keep" });
    expect(canonicalS3DraftRequest({ ...request, credentials: {} })).toEqual(
      keep,
    );
    const cleared = canonicalS3DraftRequest({ ...request, credentials: null });
    expect(cleared.credentials.secretAccessKey).toEqual({ intent: "clear" });
    expect(cleared).not.toEqual(keep);
    const replaced = canonicalS3DraftRequest({
      ...request,
      credentials: { accessKeyId: "synthetic-value" },
    });
    expect(replaced).not.toEqual(keep);
    expect(JSON.stringify(replaced)).not.toContain("synthetic-value");
    expect(
      canonicalS3DraftRequest({
        ...request,
        credentials: { accessKeyId: "different-value" },
      }),
    ).not.toEqual(replaced);
    expect(canonicalS3DraftRequest({ ...request, version: 1 })).not.toEqual(
      keep,
    );
    expect(
      canonicalS3DraftRequest({
        ...request,
        config: { ...request.config, bucket: "other-bucket" },
      }),
    ).not.toEqual(keep);
  });
  it("uses domain-separated keyed digests and normalized origins", () => {
    vi.stubEnv("TASKDESK_AUTH_SECRET", "a".repeat(64));
    const same = {
      ...request,
      credentials: { accessKeyId: "same-value", secretAccessKey: "same-value" },
    };
    const before = canonicalS3DraftRequest(same);
    expect(before.credentials.accessKeyId).not.toEqual(
      before.credentials.secretAccessKey,
    );
    vi.stubEnv("TASKDESK_AUTH_SECRET", "b".repeat(64));
    expect(canonicalS3DraftRequest(same)).not.toEqual(before);
    expect(
      canonicalS3DraftRequest({
        ...request,
        config: {
          ...request.config,
          publicBaseUrl: "https://files.example.test/",
        },
      }),
    ).toEqual(canonicalS3DraftRequest(request));
  });
  it("fails closed without the registered signing secret", () => {
    vi.stubEnv("TASKDESK_AUTH_SECRET", "");
    expect(() => canonicalS3DraftRequest(request)).toThrow(
      "Storage configuration verification unavailable",
    );
  });
});
