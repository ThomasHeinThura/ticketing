import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pathname: "/dashboard/settings/account/information",
  projects: [] as Array<{ id: string; slug: string }>,
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
        "navigation:page.backToProject": "Back to Project",
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
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: (
    _args: unknown,
    enabled: boolean,
    select: (projects: Array<{ id: string; slug: string }>) => unknown,
  ) => ({ data: enabled ? select(mocks.projects) : undefined }),
}));

import { type SettingsScope, SettingsShell } from "./settings-shell";

beforeEach(() => {
  mocks.navigate.mockReset();
});

afterEach(cleanup);

function renderSettings(pathname: string, scope?: SettingsScope) {
  mocks.pathname = pathname;
  render(
    <SettingsShell scope={scope}>
      <div>Settings content</div>
    </SettingsShell>,
  );
}

describe("SettingsShell scoped heading", () => {
  const scopes: Array<[string, SettingsScope | undefined, string]> = [
    ["/dashboard/settings/account/information", undefined, "Account"],
    ["/dashboard/settings/workspace/general", undefined, "Workspace"],
    [
      "/dashboard/settings/projects/project-1/general",
      undefined,
      "Project settings",
    ],
    ["/dashboard/settings/account/pending-actions", undefined, "Account"],
    ["/dashboard/settings/workspace/request-types", undefined, "Workspace"],
    ["/agent/god-mode", "instance", "God Mode"],
    ["/agent/god-mode/users", undefined, "God Mode"],
    ["/dashboard/settings/workspace/request-types", "account", "Account"],
  ];

  it.each(scopes)("shows only the %s scope", (pathname, scope, title) => {
    renderSettings(pathname, scope);
    expect(
      screen.getAllByText(title).some((element) => element.tagName === "H1"),
    ).toBe(true);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open settings menu" }),
    ).toBeInTheDocument();
  });
});

describe("SettingsShell back link (L-03)", () => {
  it("returns project settings to that project's board", () => {
    mocks.projects = [{ id: "project-1", slug: "SUP" }];
    renderSettings("/dashboard/settings/projects/project-1/general");
    fireEvent.click(screen.getByRole("button", { name: "Back to Project" }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      href: "/agent/projects/SUP/work?layout=board&sort=position&dir=asc",
    });
  });

  it("returns the other scopes to the workspace", () => {
    mocks.projects = [{ id: "project-1", slug: "SUP" }];
    renderSettings("/dashboard/settings/workspace/general");
    fireEvent.click(screen.getByRole("button", { name: "Back to Workspace" }));
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent" });
  });
});
