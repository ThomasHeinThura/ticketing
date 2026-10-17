import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthenticatedRouteContent } from "./authenticated-route-content";

const mocks = vi.hoisted(() => ({ pathname: "/agent/projects/OPS/work" }));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: mocks.pathname }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@taskdesk/ui", () => ({
  SidebarTrigger: ({ toggleLabel }: { toggleLabel: string }) => (
    <button aria-label={toggleLabel} type="button" />
  ),
}));
vi.mock("@/components/common/layout", () => ({
  default: Object.assign(
    ({ children }: { children: ReactNode }) => (
      <div data-testid="shared-agent-sidebar-shell">{children}</div>
    ),
    {
      Header: ({ children }: { children: ReactNode }) => (
        <header>{children}</header>
      ),
    },
  ),
}));

afterEach(() => {
  cleanup();
});

describe("AuthenticatedRouteContent", () => {
  it.each(["/agent/projects/OPS/work", "/agent/views", "/agent/views/view-1"])(
    "mounts the shared navigation shell for %s",
    (pathname) => {
      mocks.pathname = pathname;
      render(
        <AuthenticatedRouteContent>
          <div>route content</div>
        </AuthenticatedRouteContent>,
      );

      expect(
        screen.getByTestId("shared-agent-sidebar-shell"),
      ).toHaveTextContent("route content");
      expect(
        screen.getByRole("button", { name: "common:a11y.toggleSidebar" }),
      ).toBeInTheDocument();
    },
  );

  it.each(["/dashboard/workspace/ws-1", "/agent/god-mode/users"])(
    "leaves existing shell ownership unchanged for %s",
    (pathname) => {
      mocks.pathname = pathname;
      render(
        <AuthenticatedRouteContent>
          <div>route content</div>
        </AuthenticatedRouteContent>,
      );

      expect(screen.queryByTestId("shared-agent-sidebar-shell")).toBeNull();
      expect(screen.getByText("route content")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "common:a11y.toggleSidebar" }),
      ).toBeNull();
    },
  );
});
