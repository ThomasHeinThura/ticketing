import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allowed: false,
  checking: false,
  editor: vi.fn(),
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
    canManageWorkspaceSettings: () => mocks.allowed,
    isCheckingPermissions: mocks.checking,
  }),
}));
vi.mock("@/components/settings/terminology-editor", () => ({
  TerminologyEditor: (props: unknown) => {
    mocks.editor(props);
    return <div data-testid="editor" />;
  },
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));

import { Route } from "./terminology";

const Page = (Route as unknown as { component: ComponentType }).component;
function renderPage(failed = false) {
  const client = new QueryClient();
  if (failed) {
    const query = client.getQueryCache().build(client, {
      queryKey: ["workspace-capabilities", "ws-1", "member"],
    });
    query.setState({
      status: "error",
      fetchStatus: "idle",
      error: new Error("failed"),
    });
  }
  render(
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  mocks.allowed = false;
  mocks.checking = false;
  mocks.editor.mockReset();
});
describe("workspace terminology access", () => {
  it("denies without mounting the fetching editor", () => {
    renderPage();
    expect(screen.getByTestId("settings-access-denied")).toBeTruthy();
    expect(mocks.editor).not.toHaveBeenCalled();
  });
  it("waits for capabilities without mounting the editor", () => {
    mocks.checking = true;
    renderPage();
    expect(
      screen.getByRole("status", { name: "settings:accessDenied.checking" }),
    ).toBeTruthy();
    expect(mocks.editor).not.toHaveBeenCalled();
  });
  it("fails closed when the capability read fails", () => {
    mocks.checking = true;
    renderPage(true);
    expect(screen.getByTestId("settings-access-error")).toBeTruthy();
    expect(mocks.editor).not.toHaveBeenCalled();
  });
  it("mounts the editor for a settings manager", () => {
    mocks.allowed = true;
    renderPage();
    expect(mocks.editor).toHaveBeenCalledWith({
      target: { scope: "workspace", workspaceId: "ws-1" },
    });
  });
});
