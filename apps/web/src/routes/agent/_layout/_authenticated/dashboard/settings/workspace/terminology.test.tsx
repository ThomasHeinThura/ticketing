import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BUILT_IN_ROLES, type BuiltInRoleKey } from "@taskdesk/permissions";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "viewer" as string,
  checking: false,
  editor: vi.fn(),
  getTerminology: vi.fn(async () => ({})),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: { canGoBack: () => true, back: vi.fn() },
    navigate: vi.fn(),
  }),
  createFileRoute: () => (options: Record<string, unknown>) => options,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1" } }),
}));
// `/api/capabilities` reports `manageWorkspaceSettings` from the strict `workspace:manage_settings`,
// the capability the terminology routes enforce, so a role holds the flag exactly when its
// built-in capability list does.
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canManageWorkspaceSettings: () =>
      (
        BUILT_IN_ROLES[mocks.role as BuiltInRoleKey].capabilities as string[]
      ).includes("workspace:manage_settings"),
    isCheckingPermissions: mocks.checking,
  }),
}));
vi.mock("@/fetchers/terminology", () => ({
  getTerminology: mocks.getTerminology,
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
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
  mocks.role = "viewer";
  mocks.checking = false;
  mocks.editor.mockReset();
  mocks.getTerminology.mockReset().mockResolvedValue({});
});
describe("workspace terminology access", () => {
  it("shows no access for a forbidden terminology read", async () => {
    mocks.role = "admin";
    mocks.getTerminology.mockRejectedValue(
      Object.assign(new Error("Forbidden"), { status: 403 }),
    );
    renderPage();
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "states.noAccess.title",
      }),
    ).toHaveFocus();
  });

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
  it.each(["lead", "member", "viewer"])(
    "shows the no-access state to a %s, not a 403 error with Retry",
    (role) => {
      mocks.role = role;
      renderPage();
      expect(screen.getByTestId("settings-access-denied")).toBeTruthy();
      expect(screen.queryByTestId("settings-access-error")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "common:actions.retry" }),
      ).toBeNull();
      expect(screen.queryByTestId("editor")).toBeNull();
      expect(mocks.editor).not.toHaveBeenCalled();
    },
  );
  it.each(["owner", "admin"])("mounts the editor for the %s role", (role) => {
    mocks.role = role;
    renderPage();
    expect(screen.queryByTestId("settings-access-denied")).toBeNull();
    expect(mocks.editor).toHaveBeenCalledWith({
      target: { scope: "workspace", workspaceId: "ws-1" },
    });
  });
});
