import { describe, expect, it } from "vitest";
import {
  auth,
  authForHost,
  isCustomerLocalAuthEndpoint,
  portalAuth,
  resolveLocalAuthProviders,
} from "../../../apps/api/src/auth";

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

  it("keeps trusted origins and social providers scoped to the agent instance", () => {
    expect(auth.options.trustedOrigins).toEqual(["http://localhost:5173"]);
    expect(portalAuth.options.trustedOrigins).toEqual([
      "http://portal.localhost:5174",
    ]);
    expect(Object.keys(portalAuth.options.socialProviders ?? {})).toEqual([]);
    expect(Object.keys(auth.options.socialProviders ?? {})).toEqual([
      "github",
      "google",
      "discord",
    ]);
    expect(auth.options.emailAndPassword?.enabled).toBe(true);
    expect(portalAuth.options.emailAndPassword?.enabled).toBe(false);
  });
});

describe("portal-scoped local auth providers", () => {
  it("keeps customer auth closed until an enabled customer-scoped provider exists", () => {
    expect(resolveLocalAuthProviders("customer", [])).toEqual({
      password: false,
      magicLink: false,
      emailOtp: false,
    });
    expect(
      resolveLocalAuthProviders("agent", [
        {
          pluginId: "auth.password",
          enabled: true,
          scope: "instance",
          portalScope: "customer",
        },
      ]),
    ).toMatchObject({ password: true, magicLink: true });
    expect(
      resolveLocalAuthProviders("customer", [
        {
          pluginId: "auth.password",
          enabled: true,
          scope: "instance",
          portalScope: "agent",
        },
      ]),
    ).toEqual({ password: false, magicLink: false, emailOtp: false });
    expect(
      resolveLocalAuthProviders("customer", [
        {
          pluginId: "auth.password",
          enabled: true,
          scope: "instance",
          portalScope: "customer",
        },
        {
          pluginId: "auth.magic-link",
          enabled: true,
          scope: "instance",
          portalScope: "both",
        },
      ]),
    ).toEqual({ password: true, magicLink: true, emailOtp: false });
  });

  it("dispatches only the configured local sign-in endpoints", () => {
    const providers = { password: true, magicLink: true, emailOtp: true };
    expect(
      isCustomerLocalAuthEndpoint("POST", "/api/auth/sign-in/email", providers),
    ).toBe(true);
    expect(
      isCustomerLocalAuthEndpoint(
        "POST",
        "/api/auth/sign-in/magic-link",
        providers,
      ),
    ).toBe(true);
    expect(
      isCustomerLocalAuthEndpoint(
        "GET",
        "/api/auth/magic-link/verify",
        providers,
      ),
    ).toBe(true);
    expect(
      isCustomerLocalAuthEndpoint(
        "POST",
        "/api/auth/email-otp/send-verification-otp",
        providers,
      ),
    ).toBe(true);
    expect(
      isCustomerLocalAuthEndpoint(
        "POST",
        "/api/auth/sign-in/email-otp",
        providers,
      ),
    ).toBe(true);
    expect(
      isCustomerLocalAuthEndpoint("POST", "/api/auth/sign-up/email", providers),
    ).toBe(false);
    expect(
      isCustomerLocalAuthEndpoint("GET", "/api/auth/list-accounts", providers),
    ).toBe(false);
  });

  it("preserves the agent password break-glass provider", () => {
    expect(() =>
      resolveLocalAuthProviders("agent", [
        {
          pluginId: "auth.password",
          enabled: false,
          scope: "instance",
          portalScope: "agent",
        },
      ]),
    ).toThrow("auth.password must remain enabled for the agent portal.");
  });
});
