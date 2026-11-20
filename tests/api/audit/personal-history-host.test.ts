import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/feature-flag/enforce", async (original) => ({
  ...(await original<
    typeof import("../../../apps/api/src/feature-flag/enforce")
  >()),
  featureStateSomewhere: async () => "on" as const,
}));

import { createApp } from "../../../apps/api/src/index";

describe("personal history host admission", () => {
  it("admits only the exact portal metadata path and keeps generic audit closed", async () => {
    const { app } = createApp();
    const portal = { host: "portal.localhost:5174" };
    const agent = { host: "localhost:5173" };
    expect(
      (
        await app.request("/api/audit?entity_type=workspace&entity_id=x", {
          headers: portal,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/api/portal/account/settings-history?section=profile",
          { headers: portal },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          "/api/portal/account/settings-history?section=profile",
          { headers: agent },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request("/api/me/settings/history?section=profile", {
          headers: portal,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          "/api/portal/account/settings-history?section=security",
          { headers: agent },
        )
      ).status,
    ).toBe(404);
  });
});
