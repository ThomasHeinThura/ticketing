import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import SettingsSidebar, { SettingsSidebarProvider } from "./SettingsSidebar";

afterEach(cleanup);

function renderMenu(
  menuOpen: boolean,
  workspaceId: string | null = "workspace-1",
  options?: { backToProject?: string; workspaceLoading?: boolean },
) {
  return render(
    <SettingsSidebarProvider
      workspaceId={workspaceId ?? undefined}
      workspaceLoading={options?.workspaceLoading}
      backToProject={options?.backToProject}
      menuOpen={menuOpen}
      setMenuOpen={() => {}}
    >
      <SettingsSidebar>
        <a href="/dashboard/settings/workspace/members">Members</a>
      </SettingsSidebar>
    </SettingsSidebarProvider>,
  );
}

// UX-10: below lg the settings menu is the sheet, so a 768 px tablet gives the page the width.
describe("SettingsSidebar", () => {
  it("docks the menu column only from lg up", () => {
    const { container } = renderMenu(false);
    const column = container.querySelector("aside");
    expect(column).toHaveClass("hidden", "lg:block");
    expect(column).not.toHaveClass("md:block");
  });

  it("opens the same menu as a sheet below lg", async () => {
    renderMenu(true);
    const sheet = await screen.findByRole("dialog");
    expect(sheet).toHaveClass("lg:hidden");
    expect(sheet).not.toHaveClass("md:hidden");
  });

  it("disables the mobile back button inside a tooltip wrapper when workspaceId is absent", async () => {
    renderMenu(true, null);
    const back = await screen.findByRole("button", {
      name: "navigation:page.backToWorkspace",
    });
    expect(back).toBeDisabled();
    expect(back).toHaveAttribute(
      "aria-description",
      "auth:onboarding.noWorkspace.title",
    );
    expect(
      back.closest('span.block.w-full[data-slot="tooltip-trigger"]'),
    ).not.toBeNull();
  });

  it("shows Back to Project in the mobile sheet and omits no-workspace tooltip while loading", async () => {
    renderMenu(true, null, { workspaceLoading: true });
    const loadingBack = await screen.findByRole("button", {
      name: "navigation:page.backToWorkspace",
    });
    expect(loadingBack).toBeDisabled();
    expect(loadingBack).not.toHaveAttribute("aria-description");
    expect(loadingBack.closest('[data-slot="tooltip-trigger"]')).toBeNull();

    cleanup();
    renderMenu(true, "workspace-1", {
      backToProject: "/agent/projects/sup/board",
    });
    expect(
      await screen.findByRole("button", {
        name: "navigation:page.backToProject",
      }),
    ).toBeEnabled();
  });
});
