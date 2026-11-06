import { describe, expect, it } from "vitest";
import {
  type S3DraftConfig,
  s3DraftDestinationChanged,
} from "../../../apps/api/src/storage/s3-draft-schema";

const base: S3DraftConfig = {
  connector: "external",
  endpoint: "https://s3.example.test",
  publicBaseUrl: "https://files.example.test",
  region: "us-east-1",
  bucket: "bucket",
  keyPrefix: "a/",
  forcePathStyle: false,
  maxImageUploadBytes: 10_485_760,
  presignTtlSeconds: 300,
};

describe("S3 draft destination change detection", () => {
  it("flags a bucket, path-style, endpoint or connector change", () => {
    expect(s3DraftDestinationChanged(base, { ...base, bucket: "other" })).toBe(
      true,
    );
    expect(
      s3DraftDestinationChanged(base, { ...base, forcePathStyle: true }),
    ).toBe(true);
    expect(
      s3DraftDestinationChanged(base, {
        ...base,
        endpoint: "https://other.example.test",
      }),
    ).toBe(true);
    expect(
      s3DraftDestinationChanged(base, {
        connector: "bundled_seaweedfs",
        forcePathStyle: true,
        publicBaseUrl: base.publicBaseUrl,
        region: base.region,
        bucket: base.bucket,
        keyPrefix: base.keyPrefix,
        maxImageUploadBytes: base.maxImageUploadBytes,
        presignTtlSeconds: base.presignTtlSeconds,
      }),
    ).toBe(true);
  });
  it("ignores fields that do not choose the destination", () => {
    expect(
      s3DraftDestinationChanged(base, {
        ...base,
        region: "eu-west-1",
        keyPrefix: "b/",
        presignTtlSeconds: 60,
      }),
    ).toBe(false);
  });
});
