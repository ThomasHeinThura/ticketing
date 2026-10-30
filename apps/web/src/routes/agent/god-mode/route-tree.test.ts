import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.agent.gen";

/** Matches a URL against the shipped agent route tree without loading or rendering anything. */
function leafRouteId(href: string): string | undefined {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [href] }),
    context: { queryClient: new QueryClient(), user: null },
  });
  const matches = router.matchRoutes(router.latestLocation);
  return matches.at(-1)?.routeId;
}

describe("God Mode in the shipped agent route tree (L-03)", () => {
  it("puts the God Mode sign-in outside the authenticated guard", () => {
    expect(leafRouteId("/god-mode/sign-in")).toBe("/god-mode/sign-in");
    expect(leafRouteId("/god-mode/sign-in?redirect=%2Fgod-mode")).toBe(
      "/god-mode/sign-in",
    );
  });

  it("puts God Mode pages under the authenticated God Mode layout", () => {
    expect(leafRouteId("/god-mode")).toBe("/_layout/_authenticated/god-mode/");
    expect(leafRouteId("/god-mode/users")).toBe(
      "/_layout/_authenticated/god-mode/users",
    );
    expect(leafRouteId("/god-mode/observability")).toBe(
      "/_layout/_authenticated/god-mode/observability",
    );
  });

  it.each([
    "/agent/god-mode",
    "/agent/god-mode/",
    "/agent/god-mode/users",
    "/AGENT/GOD-MODE/users",
    "/agent/god-mode/organisations/org-1/identity",
  ])("sends the old link %s to the legacy redirect route", (href) => {
    expect(leafRouteId(href)).toBe("/agent/god-mode/$");
  });

  it("does not catch near-miss paths in the legacy redirect", () => {
    expect(leafRouteId("/agent/god-modex")).not.toBe("/agent/god-mode/$");
  });
});
