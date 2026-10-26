import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/dashboard/settings/account/information",
}));

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => ({ pathname: mocks.pathname }),
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "navigation:page.settingsTitle": "Settings",
        "navigation:page.backToWorkspace": "Back to Workspace",
        "settings:account": "Account",
        "navigation:page.settingsWorkspaceTab": "Workspace",
        "navigation:projectList.projectSettings": "Project settings",
        "navigation:sidebar.godMode": "God Mode",
      })[key] ?? key,
  }),
}));
vi.mock("@taskdesk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();
  return { ...actual, useIsMobile: () => true };
});
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

import { SettingsShell } from "./settings-shell";

beforeEach(() => {
  mocks.navigate.mockReset();
});

afterEach(cleanup);

function renderSettings(pathname: string, instance = false) {
  mocks.pathname = pathname;
  render(
    <SettingsShell instance={instance}>
      <div>Settings content</div>
    </SettingsShell>,
  );
}

describe("SettingsShell scoped heading", () => {
  const scopes: Array<[string, boolean, string]> = [
    ["/dashboard/settings/account/information", false, "Account"],
    ["/dashboard/settings/workspace/general", false, "Workspace"],
    [
      "/dashboard/settings/projects/project-1/general",
      false,
      "Project settings",
    ],
    ["/agent/settings/profile/preferences", false, "Account"],
    ["/agent/settings/request-types", false, "Workspace"],
    ["/agent/god-mode", true, "God Mode"],
  ];

  it.each(scopes)("shows only the %s scope", (pathname, instance, title) => {
    renderSettings(pathname, instance);
    expect(
      screen.getAllByText(title).some((element) => element.tagName === "H1"),
    ).toBe(true);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open settings menu" }),
    ).toBeInTheDocument();
  });
});
