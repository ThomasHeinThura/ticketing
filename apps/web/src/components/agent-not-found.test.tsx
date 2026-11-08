import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

import { AgentNotFound } from "./agent-not-found";

afterEach(cleanup);

/**
 * TanStack renders an unknown path's not-found in place of the Outlet of the deepest matched
 * layout (the settings shell, the agent shell). The agent router passes this component as
 * `defaultNotFoundComponent` (main.tsx), so every layout shows it inside its own frame.
 */
function renderUnknownPath(path: string) {
  const rootRoute = createRootRoute();
  const settingsShell = createRoute({
    getParentRoute: () => rootRoute,
    path: "/dashboard/settings",
    component: () => (
      <div data-testid="settings-shell">
        <Outlet />
      </div>
    ),
  });
  const general = createRoute({
    getParentRoute: () => settingsShell,
    path: "/workspace/general",
    component: () => <p>general</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([settingsShell.addChildren([general])]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultNotFoundComponent: AgentNotFound,
  });
  return render(<RouterProvider router={router} />);
}

describe("AgentNotFound (UX-8)", () => {
  it("renders a branded page inside the layout that caught the unknown address", async () => {
    renderUnknownPath("/dashboard/settings/workspace/import");
    const page = await screen.findByTestId("agent-not-found");
    expect(screen.getByTestId("settings-shell")).toContainElement(page);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: translate("portal:notFound.title"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(translate("portal:notFound.description")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Not Found$/u)).not.toBeInTheDocument();
  });

  it("offers the way back to the user's work and to the projects list", async () => {
    renderUnknownPath("/nothing-here");
    expect(
      await screen.findByRole("link", {
        name: translate("navigation:sidebar.myWork"),
      }),
    ).toHaveAttribute("href", "/agent/my-work");
    expect(
      screen.getByRole("link", {
        name: translate("navigation:sidebar.projects"),
      }),
    ).toHaveAttribute("href", "/agent");
  });

  it("never echoes the requested address", async () => {
    const { container } = renderUnknownPath("/agent/acme-secret/ref-42");
    await screen.findByTestId("agent-not-found");
    expect(container.textContent).not.toContain("acme-secret");
    expect(container.textContent).not.toContain("ref-42");
  });
});
