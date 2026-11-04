import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/components/automation/automation-rules-panel", () => ({
  AutomationRulesPanel: (props: Record<string, unknown>) => {
    mocks.panel(props);
    return <div data-testid="automation-rules-panel" />;
  },
}));

import { Route } from "./automations";

const Page = (Route as unknown as { component: ComponentType }).component;

/** A client whose `/api/capabilities` read for this scope has failed and settled. */
function failedCapabilities(queryKey: readonly unknown[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client
    .getQueryCache()
    .build(client, { queryKey: [...queryKey] })
    .setState({
      status: "error",
      fetchStatus: "idle",
      error: new Error("Failed to get capabilities"),
    });
  return client;
}

function renderWithClient(node: ReactNode, client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.checking = false;
  mocks.panel.mockClear();
});

describe("Workspace automations access (UAT re-audit)", () => {
  it("shows one access notice and never mounts the rules list without workspace:manage_settings", () => {
    mocks.canManageWorkspaceSettings = false;
    renderWithClient(<Page />);
    expect(screen.getByTestId("settings-access-denied")).toBeInTheDocument();
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("mounts the manageable rules list for a role with the capability", () => {
    mocks.canManageWorkspaceSettings = true;
    renderWithClient(<Page />);
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
    expect(mocks.panel).toHaveBeenCalledWith(
      expect.objectContaining({ canManage: true, workspaceId: "ws-1" }),
    );
  });

  it("offers Retry, not a permanent skeleton, when the capability read fails", () => {
    mocks.checking = true;
    renderWithClient(
      <Page />,
      failedCapabilities(["workspace-capabilities", "ws-1", "admin"]),
    );
    expect(screen.getByTestId("settings-access-error")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "common:actions.retry" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
});
