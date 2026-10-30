import { describe, expect, it } from "vitest";
import {
  godModeRedirectPath,
  isGodModePath,
  legacyGodModeRedirectHref,
} from "./god-mode-paths";
import { routes } from "./routes";
import { getSafeRedirectPath } from "./safe-redirect";

describe("getSafeRedirectPath", () => {
  it.each([
    "/dashboard",
    "/god-mode/users?q=Ada&user=user%2Fone",
    "/agent/projects/SUP/work#task-1",
  ])("accepts the same-origin path %s", (value) => {
    expect(getSafeRedirectPath(value)).toBe(value);
  });

  it.each([
    undefined,
    null,
    "",
    "dashboard",
    "https://evil.com",
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\\/evil.com",
    "/god-mode//evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/ /evil.com",
    "/god-mode/../dashboard",
    "/./evil",
    "javascript:alert(1)",
  ])("rejects %j", (value) => {
    expect(getSafeRedirectPath(value)).toBeUndefined();
  });
});

describe("isGodModePath", () => {
  it.each(["/god-mode", "/god-mode/", "/god-mode/users", "/GOD-MODE/Users"])(
    "treats %s as God Mode",
    (path) => {
      expect(isGodModePath(path)).toBe(true);
    },
  );

  it.each(["/god-modex", "/agent/god-mode", "/dashboard", "/"])(
    "does not treat %s as God Mode",
    (path) => {
      expect(isGodModePath(path)).toBe(false);
    },
  );
});

describe("godModeRedirectPath", () => {
  it("keeps a safe God Mode path with its search and hash", () => {
    expect(godModeRedirectPath("/god-mode/users?q=Ada#row")).toBe(
      "/god-mode/users?q=Ada#row",
    );
  });

  it.each([
    undefined,
    "",
    "//evil.com",
    "https://evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/dashboard",
    "/god-modex",
    "/god-mode/sign-in",
    "/GOD-MODE/Sign-In/",
    "/god-mode/sign-in?redirect=/god-mode/users",
    "/god-mode/../dashboard",
  ])("falls back to God Mode home for %j", (value) => {
    expect(godModeRedirectPath(value)).toBe("/god-mode");
  });
});

describe("legacyGodModeRedirectHref (L-03)", () => {
  it.each([
    ["/agent/god-mode", "/god-mode"],
    ["/agent/god-mode/", "/god-mode"],
    ["/agent/god-mode/users", "/god-mode/users"],
    ["/AGENT/God-Mode/users", "/god-mode/users"],
    [
      "/agent/god-mode/users?q=Ada&user=user%2Fone#row",
      "/god-mode/users?q=Ada&user=user%2Fone#row",
    ],
    ["/agent/god-mode?tab=x", "/god-mode?tab=x"],
    [
      "/agent/god-mode/authentication/conn%2FA?tab=scim",
      "/god-mode/authentication/conn%2FA?tab=scim",
    ],
    [
      "/agent/god-mode/organisations/Org-1/identity",
      "/god-mode/organisations/Org-1/identity",
    ],
    ["/agent/god-mode/imports/run-1/", "/god-mode/imports/run-1"],
    ["/agent/god-modex", "/god-mode"],
    ["/somewhere-else", "/god-mode"],
  ])("maps %s to %s", (from, to) => {
    expect(legacyGodModeRedirectHref(from)).toBe(to);
  });
});

describe("God Mode route registry (L-03)", () => {
  it("registers God Mode at the agent host root", () => {
    expect(routes.godModeHealth.build()).toBe("/god-mode");
    expect(routes.godModeUsers.build()).toBe("/god-mode/users");
    expect(routes.godModeObservability.build()).toBe("/god-mode/observability");
    expect(routes.godModeSignIn.path).toBe("/god-mode/sign-in");
  });

  it("builds the sign-in URL with only a safe God Mode redirect", () => {
    expect(routes.godModeSignIn.build()).toBe("/god-mode/sign-in");
    expect(
      routes.godModeSignIn.build({ redirect: "/god-mode/users?q=Ada" }),
    ).toBe("/god-mode/sign-in?redirect=%2Fgod-mode%2Fusers%3Fq%3DAda");
    expect(routes.godModeSignIn.build({ redirect: "//evil.com" })).toBe(
      "/god-mode/sign-in",
    );
    expect(routes.godModeSignIn.build({ redirect: "/dashboard" })).toBe(
      "/god-mode/sign-in",
    );
  });
});

describe("encoded dot segments", () => {
  it("rejects percent-encoded dot segments that would resolve outside God Mode", () => {
    for (const value of [
      "/god-mode/%2e%2e/agent/x",
      "/god-mode/%2E%2e/%2e%2E/",
      "/god-mode/%2e/users",
      "/dashboard/%2E%2E/god-mode",
    ])
      expect(getSafeRedirectPath(value)).toBeUndefined();
    expect(godModeRedirectPath("/god-mode/%2e%2e/agent/x")).toBe("/god-mode");
  });

  it("keeps encoded characters that are not dot segments", () => {
    expect(getSafeRedirectPath("/god-mode/users?q=a%2eb")).toBe(
      "/god-mode/users?q=a%2eb",
    );
    expect(getSafeRedirectPath("/god-mode/imports/a%2Eb")).toBe(
      "/god-mode/imports/a%2Eb",
    );
  });
});
