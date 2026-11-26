import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/utils/access-lookups.repository", () => ({
  findActiveApiKeyByHash: vi.fn(async () => undefined),
  findApiKeyOwnerStatus: vi.fn(),
}));
vi.mock("../../../apps/api/src/api-key/repository", () => ({
  findActiveApiKeysBySelector: vi.fn(async () => [
    { id: "candidate", key: "hash" },
  ]),
  loadApiKeyKind: vi.fn(),
  upgradeApiKeyHash: vi.fn(),
}));
vi.mock("../../../apps/api/src/api-key/secret-hash", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../apps/api/src/api-key/secret-hash")
    >();
  return {
    ...actual,
    verifyApiKeySecret: vi.fn(async () => ({
      valid: false,
      needsRehash: false,
    })),
  };
});

import { verifyApiKey } from "../../../apps/api/src/utils/verify-api-key";

describe("API key failure address buckets", () => {
  it("shares a /64 bucket and bounds requests without a trusted IP", async () => {
    for (let i = 0; i < 11; i++) {
      await verifyApiKey("invalid");
      await verifyApiKey("invalid", {
        clientIp: `2001:db8:abcd:1234::${i + 1}`,
      });
    }
    await expect(
      verifyApiKey("tdk_abcdefghijklmnop", {
        clientIp: "2001:db8:abcd:1234::ff",
      }),
    ).rejects.toMatchObject({ status: 429 });
    await expect(verifyApiKey("tdk_abcdefghijklmnop")).rejects.toMatchObject({
      status: 429,
    });
    expect(
      await verifyApiKey("tdk_abcdefghijklmnop", {
        clientIp: "2001:db8:abcd:1235::1",
      }),
    ).toBeNull();
  });

  it("rejects junk keys with 429 once the address is over its failure limit", async () => {
    const clientIp = "198.51.100.7";
    for (let i = 0; i < 11; i++) {
      expect(await verifyApiKey("invalid", { clientIp })).toBeNull();
    }
    await expect(verifyApiKey("invalid", { clientIp })).rejects.toMatchObject({
      status: 429,
    });
  });
});
