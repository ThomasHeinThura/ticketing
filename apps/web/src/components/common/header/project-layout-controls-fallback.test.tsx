import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import ProjectLayoutControlsFallback from "./project-layout-controls-fallback";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

describe("ProjectLayoutControlsFallback", () => {
  it("keeps the project context and available navigation names readable while controls load", () => {
    render(
      <ProjectLayoutControlsFallback
        projectName="ENG"
        showViewSwitcher
        viewLabels={[
          "Overview",
          "Backlog",
          "Work items",
          "Calendar",
          "Timeline",
        ]}
      />,
    );

    const fallback = screen.getByRole("status", {
      name: `${translate("common:empty.loading")} ${translate("navigation:projectViews.selectProject")}: ENG. Overview. Backlog. ${translate("navigation:projectViews.workItems")}. Calendar. Timeline`,
    });
    expect(fallback).toHaveClass("min-w-0", "flex-1");
    expect(fallback.querySelector(".overflow-hidden")).toBeInTheDocument();
    expect(screen.getByText("ENG")).toBeInTheDocument();
  });

  it("does not announce view switches when this layout hides them", () => {
    render(
      <ProjectLayoutControlsFallback
        projectName="ENG"
        showViewSwitcher={false}
        viewLabels={[
          "Overview",
          "Backlog",
          "Work items",
          "Calendar",
          "Timeline",
        ]}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: `${translate("common:empty.loading")} ${translate("navigation:projectViews.selectProject")}: ENG`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        `Backlog, ${translate("navigation:projectViews.workItems")}, Calendar, Gantt`,
      ),
    ).toBeNull();
  });
});
