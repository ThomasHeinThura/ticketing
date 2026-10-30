import { SidebarProvider } from "@taskdesk/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/lib/routes";
import { translate } from "@/test/en-translation";
import { WorkspaceSwitcher } from "./workspace-switcher";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  role: "user" as string,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/components/notification/notification-dropdown", () => ({
  default: () => null,
}));
vi.mock("@/components/user-avatar", () => ({ UserAvatar: () => null }));
vi.mock("@/hooks/use-user-websocket", () => ({ useUserWebSocket: () => {} }));
vi.mock("@/hooks/use-keyboard-shortcuts", () => ({
  getModifierKeyText: () => "Ctrl",
  useRegisterShortcuts: () => {},
}));
vi.mock("@/fetchers/workspace/activate-workspace", () => ({
  default: vi.fn(),
}));
vi.mock("@/hooks/queries/config/use-get-config", () => ({
  default: () => ({ data: { disableWorkspaceCreation: true } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws-1", name: "Support" } }),
}));
vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({ data: [{ id: "ws-1", name: "Support" }] }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "u-1", role: mocks.role } } }),
  },
}));

function renderSwitcher() {
  render(
    <SidebarProvider>
      <WorkspaceSwitcher />
    </SidebarProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Support/ }));
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    (query: string): MediaQueryList =>
      ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as MediaQueryList,
  );
  mocks.role = "user";
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.navigate.mockReset();
});

describe("WorkspaceSwitcher settings entries (L-03)", () => {
  it("offers Workspace settings to every member", async () => {
    renderSwitcher();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Workspace settings" }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: routes.workspaceGeneral.path,
    });
    expect(routes.workspaceGeneral.path).toBe(
      "/dashboard/settings/workspace/general",
    );
  });

  it("hides God Mode from non-admins", async () => {
    renderSwitcher();
    await screen.findByRole("menuitem", { name: "Workspace settings" });
    expect(screen.queryByRole("menuitem", { name: "God Mode" })).toBeNull();
  });

  it("gives instance admins one God Mode item in place of the separate admin pages", async () => {
    mocks.role = "admin";
    renderSwitcher();

    await screen.findByRole("menuitem", { name: "Workspace settings" });
    expect(
      screen.queryByRole("menuitem", { name: "Instance users" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "Notification delivery" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "God Mode" }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: routes.godModeHealth.path,
    });
    expect(routes.godModeHealth.path).toBe("/god-mode");
  });
});
