import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * UAT role sweep: member/lead/viewer opened Workspace features and the panel fired
 * `GET /api/workspaces/{id}/features`, which needs `workspace:manage_settings` and answered 403.
 * The capability is now checked first; without it the panel never mounts and never fetches.
 */
const mocks = vi.hoisted(() => ({
  canManageWorkspaceSettings: false,
  checking: false,
  panel: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () => mocks.canManageWorkspaceSettings,
    isCheckingPermissions: mocks.checking,
  }),
}));
vi.mock("@/components/settings/feature-flags-panel", () => ({
  FeatureFlagsPanel: (props: Record<string, unknown>) => {
    mocks.panel(props);
    return <div data-testid="feature-flags-panel" />;
  },
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));

import { Route } from "./features";

const Page = (Route as unknown as { component: ComponentType }).component;

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Page />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.panel.mockReset();
  mocks.canManageWorkspaceSettings = false;
  mocks.checking = false;
});

describe("workspace features settings", () => {
  it("shows the access notice and never mounts the panel without workspace:manage_settings", () => {
    renderPage();
    expect(screen.getByTestId("settings-access-denied")).toBeTruthy();
    expect(screen.queryByTestId("feature-flags-panel")).toBeNull();
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it("waits on the capability check without mounting the panel", async () => {
    mocks.checking = true;
    renderPage();
    expect(
      await screen.findByRole("status", {
        name: "settings:accessDenied.checking",
      }),
    ).toBeTruthy();
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it("renders the workspace panel for a caller who can manage settings", () => {
    mocks.canManageWorkspaceSettings = true;
    renderPage();
    expect(screen.getByTestId("feature-flags-panel")).toBeTruthy();
    expect(mocks.panel).toHaveBeenCalledWith({
      target: { level: "workspace", workspaceId: "ws-1" },
    });
  });
});
