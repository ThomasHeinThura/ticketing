import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: { getSession: vi.fn() },
}));
vi.mock("@/fetchers/feature-flags", () => ({
  getPortalFeatureState: async () => "on",
}));

import { Route as PortalRootRoute } from "@/routes/portal/__root";

afterEach(cleanup);

/**
 * The portal root's own `notFoundComponent`, mounted under a root route that supplies the
 * same context the portal root's `beforeLoad` returns (signed in, or the session-free frame).
 */
function renderUnknownPath(context: { portalUserId?: string } | undefined) {
  const rootRoute = createRootRoute({
    beforeLoad: () => context,
    component: () => (
      <div data-testid="portal-layout">
        <Outlet />
      </div>
    ),
    notFoundComponent: PortalRootRoute.options.notFoundComponent,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/nothing-here"] }),
  });
  render(<RouterProvider router={router} />);
}

describe("portal root not-found (finding #7)", () => {
  it("renders the branded page inside the root layout with a dashboard link when signed in", async () => {
    renderUnknownPath({ portalUserId: "u1" });
    const back = await screen.findByRole("link", {
      name: "notFound.backToDashboard",
    });
    expect(back).toHaveAttribute("href", "/");
    expect(screen.getByTestId("portal-layout")).toContainElement(
      screen.getByTestId("portal-not-found"),
    );
  });

  it("offers sign-in when the root has no session", async () => {
    renderUnknownPath(undefined);
    expect(
      await screen.findByRole("link", { name: "notFound.signIn" }),
    ).toBeInTheDocument();
  });
});
