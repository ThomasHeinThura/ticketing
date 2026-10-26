import { describe, expect, it } from "vitest";
import { browserStorageOrigins } from "../../../apps/api/src/storage/csp-origins";

describe("storage CSP origins", () => {
  it("retains only the configured endpoint origin for path-style storage", () => {
    expect(
      browserStorageOrigins({
        endpoint: "https://files.example.test/storage/",
        bucket: "private-files",
        forcePathStyle: true,
      }),
    ).toEqual(["https://files.example.test"]);
  });

  it("allows only the configured bucket virtual host alongside the endpoint", () => {
    expect(
      browserStorageOrigins({
        endpoint: "https://s3.example.test:9443",
        bucket: "private-files",
        forcePathStyle: false,
      }),
    ).toEqual([
      "https://s3.example.test:9443",
      "https://private-files.s3.example.test:9443",
    ]);
  });

  it("keeps IP endpoints path-addressed even if virtual hosting was requested", () => {
    expect(
      browserStorageOrigins({
        endpoint: "http://127.0.0.1:9000",
        bucket: "private-files",
        forcePathStyle: false,
      }),
    ).toEqual(["http://127.0.0.1:9000"]);
    expect(
      browserStorageOrigins({
        endpoint: "http://[::1]:9000",
        bucket: "private-files",
        forcePathStyle: false,
      }),
    ).toEqual(["http://[::1]:9000"]);
  });

  it("refuses credential-bearing, signed or non-HTTP origins", () => {
    for (const endpoint of [
      "https://user:fixture@files.example.test",
      "https://files.example.test?signature=fixture",
      "https://files.example.test#fragment",
      "javascript:alert(1)",
    ]) {
      expect(() =>
        browserStorageOrigins({
          endpoint,
          bucket: "private-files",
          forcePathStyle: true,
        }),
      ).toThrow("Storage browser origin is invalid");
    }
  });
});
