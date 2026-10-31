import { describe, expect, it } from "vitest";
import { routes } from "@/lib/routes";
import {
  isPortalNavigationActive,
  portalAriaCurrent,
  portalSupportMatch,
} from "./portal-navigation";

const dashboard = { to: routes.portalHome.path, exact: true };

describe("portal navigation matching", () => {
  it("matches the dashboard on / only", () => {
    expect(isPortalNavigationActive("/", dashboard)).toBe(true);
    expect(isPortalNavigationActive("/requests", dashboard)).toBe(false);
  });

  it("keeps Support active across requests, request detail, catalogue, approvals and KB", () => {
    for (const pathname of [
      "/requests",
      "/submissions/SUB-7",
      "/catalogue",
      "/approvals",
      "/kb",
      "/kb/article-1",
    ])
      expect(isPortalNavigationActive(pathname, portalSupportMatch)).toBe(true);
    for (const pathname of ["/", "/notifications", "/releases", "/account"])
      expect(isPortalNavigationActive(pathname, portalSupportMatch)).toBe(
        false,
      );
  });

  it("matches whole path segments, never a longer sibling", () => {
    const updates = { to: routes.portalInbox.path };
    expect(isPortalNavigationActive("/notifications", updates)).toBe(true);
    expect(isPortalNavigationActive("/notificationsx", updates)).toBe(false);
    expect(isPortalNavigationActive("/requestsx", portalSupportMatch)).toBe(
      false,
    );
    const announcements = { to: routes.portalReleases.path };
    expect(isPortalNavigationActive("/releases/r-1", announcements)).toBe(true);
  });

  it("marks only the exact page as current", () => {
    expect(portalAriaCurrent("/requests", "/requests")).toBe("page");
    expect(
      portalAriaCurrent("/submissions/SUB-7", "/requests"),
    ).toBeUndefined();
  });
});
