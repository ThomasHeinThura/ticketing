import { beforeEach, describe, expect, it, vi } from "vitest";

// Real modules, no mocks: `auth.ts` builds its Better Auth contexts as soon as it loads, and the
// credential adapter factory reads `credentialDatabase`, so `auth` must not load before the
// credential module has finished initialising.
describe("credential adapter import order", () => {
  beforeEach(() => vi.resetModules());

  it("initialises both auth contexts when credential invalidation is imported first", async () => {
    const credential = await import(
      "../../../apps/api/src/pending-action/credential-invalidation"
    );
    const { auth, portalAuth } = await import("../../../apps/api/src/auth");

    const [agent, portal] = await Promise.all([
      auth.$context,
      portalAuth.$context,
    ]);

    for (const context of [agent, portal])
      expect(typeof context.adapter.transaction).toBe("function");
    expect(typeof credential.createCredentialAwareDrizzleAdapter).toBe(
      "function",
    );
  });
});
