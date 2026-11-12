import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({ state: vi.fn(), credential: vi.fn() }));
vi.mock("../../apps/api/src/auth/local-factor-service", () => ({
  loadLocalFactorState: fixtures.state,
  InactiveFactorIdentityError: class InactiveFactorIdentityError extends Error {},
}));
vi.mock("../../apps/api/src/permissions/strict-policy-enforcement", () => ({
  enforceRegisteredPolicy: (_context: unknown, next: () => Promise<unknown>) =>
    next(),
}));
vi.mock("../../apps/api/src/auth/repository", () => ({
  getPasswordCredential: fixtures.credential,
}));

import factorStatus from "../../apps/api/src/auth/factor-status-api";

function appFor(session: boolean, apiKey = false) {
  const app = new Hono<{
    Variables: {
      userId: string;
      session: { id: string } | null;
      apiKey: { id: string } | undefined;
    };
  }>();
  app.use("*", async (c, next) => {
    c.set("userId", "caller");
    c.set("session", session ? { id: "own-session" } : null);
    c.set("apiKey", apiKey ? { id: "key" } : undefined);
    await next();
  });
  app.route("/", factorStatus);
  return app;
}
beforeEach(() => {
  fixtures.state.mockReset().mockResolvedValue({
    enabled: true,
    required: false,
    policy: { mode: "optional" },
  });
  fixtures.credential.mockReset();
});
describe("factor status local password", () => {
  it("requires a session and rejects API keys", async () => {
    expect((await appFor(false).request("/security/factors")).status).toBe(401);
    expect((await appFor(true, true).request("/security/factors")).status).toBe(
      401,
    );
    expect(fixtures.credential).not.toHaveBeenCalled();
  });
  it.each([
    [true, [{ password: "hash" }]],
    [false, []],
  ])(
    "reports local-password presence %s with MFA enabled",
    async (hasLocalPassword, accounts) => {
      fixtures.credential.mockResolvedValue(accounts);
      const response = await appFor(true).request(
        "/security/factors?userId=someone-else",
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        hasLocalPassword,
        enabled: true,
        passwordRequiredForEnrollment: false,
      });
      expect(fixtures.credential).toHaveBeenCalledWith("caller");
    },
  );
});
