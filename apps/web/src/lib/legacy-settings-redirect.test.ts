import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import {
  legacySettingsRedirectHref,
  legacySettingsRedirectPath,
} from "./legacy-settings-redirect";

describe("legacySettingsRedirectPath", () => {
  it.each([
    ["/agent/settings", "/dashboard/settings/workspace/general"],
    ["/agent/settings/", "/dashboard/settings/workspace/general"],
    ["/agent/settings/danger", "/dashboard/settings/workspace/general"],
    ["/agent/settings/members", "/dashboard/settings/workspace/members"],
    ["/agent/settings/labels", "/dashboard/settings/workspace/labels"],
    ["/agent/settings/roles", "/dashboard/settings/workspace/roles"],
    ["/agent/settings/roles/r1", "/dashboard/settings/workspace/roles/r1"],
    [
      "/agent/settings/webhooks/w1/deliveries",
      "/dashboard/settings/workspace/webhooks/w1/deliveries",
    ],
    [
      "/agent/settings/integrations/webhooks/w1",
      "/dashboard/settings/workspace/webhooks/w1",
    ],
    ["/agent/settings/profile", "/dashboard/settings/account/information"],
    [
      "/agent/settings/profile/api-keys",
      "/dashboard/settings/account/developer",
    ],
    [
      "/agent/settings/profile/notifications",
      "/dashboard/settings/account/notifications",
    ],
    [
      "/agent/settings/profile/appearance",
      "/dashboard/settings/account/preferences",
    ],
    [
      "/agent/settings/profile/security",
      "/dashboard/settings/account/security",
    ],
    [
      "/agent/settings/profile/unknown",
      "/dashboard/settings/account/information",
    ],
    [
      "/agent/settings/profile/pending-actions",
      "/dashboard/settings/account/pending-actions",
    ],
    [
      "/agent/settings/profile/pending-actions/pa%2F1",
      "/dashboard/settings/account/pending-actions/pa%2F1",
    ],
    [
      "/agent/settings/projects/p1/budget",
      "/dashboard/settings/projects/p1/budget",
    ],
  ])("sends %s to %s", (from, to) => {
    expect(legacySettingsRedirectPath(from)).toBe(to);
  });

  it("keeps the search and hash of the old link", () => {
    expect(
      legacySettingsRedirectHref("/agent/settings/calendars?cursor=a%2Fb#top"),
    ).toBe("/dashboard/settings/workspace/calendars?cursor=a%2Fb#top");
    expect(
      legacySettingsRedirectHref(
        "/agent/settings/profile/pending-actions?cursor=c1",
      ),
    ).toBe("/dashboard/settings/account/pending-actions?cursor=c1");
  });

  it("never leaves the settings area", () => {
    expect(legacySettingsRedirectPath("/agent/settings//evil.example")).toBe(
      "/dashboard/settings/workspace//evil.example",
    );
  });
});

describe("old /agent/settings links in the router", () => {
  function buildRouter(initial: string) {
    const root = createRootRoute();
    const legacy = createRoute({
      getParentRoute: () => root,
      path: "/agent/settings/$",
      beforeLoad: ({ location }) => {
        throw redirect({
          href: legacySettingsRedirectHref(location.href),
          replace: true,
        });
      },
    });
    const pendingAction = createRoute({
      getParentRoute: () => root,
      path: "/dashboard/settings/account/pending-actions/$id",
    });
    const calendars = createRoute({
      getParentRoute: () => root,
      path: "/dashboard/settings/workspace/calendars",
    });
    return createRouter({
      routeTree: root.addChildren([legacy, pendingAction, calendars]),
      history: createMemoryHistory({ initialEntries: [initial] }),
    });
  }

  it("opens a pending-action approval at its account URL with the same encoded id", async () => {
    const router = buildRouter(
      "/agent/settings/profile/pending-actions/pa%2F1",
    );
    await router.load();
    expect(router.state.location.href).toBe(
      "/dashboard/settings/account/pending-actions/pa%2F1",
    );
    expect(router.state.matches.at(-1)?.params).toEqual({ id: "pa/1" });
  });

  it("keeps the search params of an old workspace page link", async () => {
    const router = buildRouter("/agent/settings/calendars?cursor=a%2Fb");
    await router.load();
    expect(router.state.location.pathname).toBe(
      "/dashboard/settings/workspace/calendars",
    );
    expect(router.state.location.search).toEqual({ cursor: "a/b" });
  });
});
