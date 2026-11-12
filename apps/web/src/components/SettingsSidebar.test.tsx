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

function renderMenu(menuOpen: boolean) {
  return render(
    <SettingsSidebarProvider
      workspaceId="workspace-1"
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
});
