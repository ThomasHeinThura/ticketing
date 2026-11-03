import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import MobileProjectNav from "./mobile-project-nav";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [] }),
}));

afterEach(cleanup);

describe("MobileProjectNav accessibility", () => {
  it("names the icon-only menu trigger", () => {
    render(
      <MobileProjectNav
        workspaceId="workspace-1"
        projectId="project-1"
        activeView="board"
        onSelectBoard={vi.fn()}
        onSelectBacklog={vi.fn()}
        onSelectCalendar={vi.fn()}
        onSelectGantt={vi.fn()}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", {
        name: translate("navigation:mobileProjectNav.menuLabel"),
      }),
    ).toBeInTheDocument();
  });
});

describe("MobileProjectNav project settings (L-03)", () => {
  const baseProps = {
    workspaceId: "workspace-1",
    projectId: "project-1",
    activeView: "board" as const,
    onSelectBoard: vi.fn(),
    onSelectBacklog: vi.fn(),
    onSelectProject: vi.fn(),
  };

  it("offers Project settings when the caller provides it", async () => {
    const onOpenProjectSettings = vi.fn();
    render(
      <MobileProjectNav
        {...baseProps}
        onOpenProjectSettings={onOpenProjectSettings}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("navigation:mobileProjectNav.menuLabel"),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Project settings" }),
    );
    expect(onOpenProjectSettings).toHaveBeenCalledTimes(1);
  });

  it("hides Project settings without a handler", async () => {
    render(<MobileProjectNav {...baseProps} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("navigation:mobileProjectNav.menuLabel"),
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Work items" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Project settings" }),
    ).toBeNull();
  });
});

describe("MobileProjectNav wording", () => {
  it("names the views and sections in the app's language, matching the tab strip", async () => {
    render(
      <MobileProjectNav
        workspaceId="workspace-1"
        projectId="project-1"
        activeView="backlog"
        onSelectBoard={vi.fn()}
        onSelectBacklog={vi.fn()}
        onSelectProject={vi.fn()}
        onAddProject={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("navigation:mobileProjectNav.menuLabel"),
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Work items" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backlog" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Board/ })).toBeNull();
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add Project" }),
    ).toBeInTheDocument();
  });
});
