import { describe, expect, it } from "vitest";
import { auth, authForHost, portalAuth } from "../../../apps/api/src/auth";

describe("portal-bound authentication configuration", () => {
  it("uses distinct __Host session cookies with host-only secure attributes", () => {
    const agentCookie = auth.options.advanced?.cookies?.session_token;
    const portalCookie = portalAuth.options.advanced?.cookies?.session_token;

    expect(agentCookie?.name).toBe("__Host-tdk_agent_session");
    expect(portalCookie?.name).toBe("__Host-tdk_portal_session");
    for (const cookie of [agentCookie, portalCookie]) {
      expect(cookie?.attributes).toMatchObject({
        secure: true,
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }
    expect(auth.options.advanced?.useSecureCookies).toBe(false);
    expect(portalAuth.options.advanced?.useSecureCookies).toBe(false);
  });

  it("selects an auth instance only for its configured request host", () => {
    expect(authForHost("localhost:5173")).toBe(auth);
    expect(authForHost("portal.localhost:5174")).toBe(portalAuth);
    expect(authForHost("localhost:5174")).toBeNull();
    expect(authForHost("localhost:5175")).toBeNull();
  });
});
