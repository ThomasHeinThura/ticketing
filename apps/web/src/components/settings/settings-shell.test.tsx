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
  // The skip link's SidebarProvider reads the viewport through matchMedia (absent in jsdom).
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
    ["/god-mode", "instance", "God Mode"],
    ["/god-mode/users", undefined, "God Mode"],
    ["/dashboard/settings/workspace/request-types", "account", "Account"],
  ];

  it.each(scopes)("shows only the %s scope", (pathname, scope, title) => {
    renderSettings(pathname, scope);
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open settings menu" }),
    ).toBeInTheDocument();
  });
});

describe("SettingsShell headings (UAT re-audit: one h1 per page)", () => {
  it("leaves the page's h1 to the settings page itself", () => {
    renderSettings("/dashboard/settings/projects/project-1/general");
    // The shell names the settings area but is not a heading, so a page's own
    // "General Settings" h1 is the only one (axe page-has-heading-one / one-h1 rule).
    expect(screen.queryAllByRole("heading", { level: 1 })).toHaveLength(0);
    expect(screen.getAllByText("Project settings").length).toBeGreaterThan(0);
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

describe("SettingsShell landmarks (a11y #11, #13)", () => {
  it.each([
    ["/dashboard/settings/workspace/general", undefined],
    ["/god-mode/organisations", "instance" as const],
  ])("starts %s with a skip link to its one main", (pathname, scope) => {
    renderSettings(pathname, scope);
    const skipLink = screen.getByRole("link", {
      name: "common:a11y.skipToContent",
    });
    const mains = screen.getAllByRole("main");
    expect(mains).toHaveLength(1);
    expect(skipLink).toHaveAttribute("href", `#${mains[0]?.id}`);
    expect(mains[0]).toHaveTextContent("Settings content");

    // First Tab stop: nothing focusable precedes the skip link.
    const focusables = document.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])",
    );
    expect(focusables[0]).toBe(skipLink);

    fireEvent.click(skipLink);
    expect(document.activeElement).toBe(mains[0]);
  });

  it("keeps the area title inside the banner landmark", () => {
    renderSettings("/god-mode/organisations", "instance");
    const banner = screen.getByRole("banner");
    expect(banner).toHaveTextContent("God Mode");
    expect(banner).toContainElement(
      screen.getByRole("button", { name: "Open settings menu" }),
    );
  });
});
