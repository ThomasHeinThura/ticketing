/** IP-25: discovery-document health classification (DB-free). */
import { describe, expect, it } from "vitest";
import {
  healthForDiscoveryResult,
  probeConnectionHealth,
} from "../../../apps/api/src/identity/connection-health.js";

const TENANT = "11111111-2222-3333-4444-555555555555";

describe("identity connection health (IP-25)", () => {
  it("classifies a loaded discovery document as healthy", async () => {
    await expect(
      probeConnectionHealth(TENANT, async () => ({ issuer: "x" })),
    ).resolves.toBe("healthy");
  });

  it("classifies an unreachable, slow or erroring IdP as degraded", async () => {
    for (const error of [
      new Error("fetch failed"),
      new Error("Identity provider request failed"),
      new DOMException("timed out", "TimeoutError"),
    ])
      await expect(
        probeConnectionHealth(TENANT, async () => {
          throw error;
        }),
      ).resolves.toBe("degraded");
  });

  it("classifies configuration that cannot name a valid document as invalid", async () => {
    await expect(probeConnectionHealth(null)).resolves.toBe("invalid");
    expect(
      healthForDiscoveryResult(
        new Error("Identity provider configuration is invalid"),
      ),
    ).toBe("invalid");
  });
});
