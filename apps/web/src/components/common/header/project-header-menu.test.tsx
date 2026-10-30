import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { routes } from "@/lib/routes";
import { translate } from "@/test/en-translation";
import ProjectHeaderMenu from "./project-header-menu";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

afterEach(() => {
  cleanup();
  mocks.navigate.mockReset();
});

describe("ProjectHeaderMenu (L-03)", () => {
  it("opens Project settings general for the current project", async () => {
    render(<ProjectHeaderMenu projectId="project-1" />);

    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Project settings" }),
    );

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: routes.projectSettingsGeneral.path,
      params: { projectId: "project-1" },
    });
    expect(
      routes.projectSettingsGeneral.build({ projectId: "project-1" }),
    ).toBe("/dashboard/settings/projects/project-1/general");
  });
});
