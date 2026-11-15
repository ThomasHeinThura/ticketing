import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/sign-in",
  imported: false,
  preload: vi.fn(),
  user: { name: "Ada Customer", email: "ada@example.test", image: null },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: undefined }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createRootRoute: (options: object) => ({
    options,
    useRouteContext: () => ({
      portalUserId: "customer-1",
      portalUser: state.user,
    }),
  }),
  useLocation: () => ({ pathname: state.pathname }),
  Outlet: () => <p>Portal page</p>,
}));
vi.mock("@/components/portal/portal-layout", () => {
  state.imported = true;
  return {
    preloadPortalChrome: state.preload,
    default: ({
      children,
      user,
    }: {
      children: ReactNode;
      user: typeof state.user;
    }) => (
      <section data-testid="signed-in-layout" aria-label={user.name}>
        {children}
      </section>
    ),
  };
});

import { Route } from "./__root";

afterEach(cleanup);
it("defers the signed-in layout on sign-in and preserves it after it loads", async () => {
  expect(state.imported).toBe(false);
  const Root = Route.options.component as ComponentType;
  const view = render(<Root />);
  expect(screen.getByText("Portal page")).toBeVisible();
  expect(state.imported).toBe(false);
  state.pathname = "/requests";
  view.rerender(<Root />);
  expect(screen.getByTestId("page-loading")).toBeVisible();
  const layout = await screen.findByTestId("signed-in-layout");
  expect(layout).toHaveAttribute("aria-label", "Ada Customer");
  expect(layout).toContainElement(screen.getByText("Portal page"));
  expect(state.preload).toHaveBeenCalledOnce();
  state.pathname = "/approvals";
  view.rerender(<Root />);
  expect(screen.getByTestId("signed-in-layout")).toBe(layout);
});
