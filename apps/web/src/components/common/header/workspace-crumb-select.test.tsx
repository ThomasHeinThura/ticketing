import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import WorkspaceCrumbSelect from "./workspace-crumb-select";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "navigation:sidebar.overview" ? "Overview" : "Select workspace",
  }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({
    data: { id: "workspace-1", name: "A long workspace name" },
  }),
}));

describe("WorkspaceCrumbSelect", () => {
  it("constrains the crumb while retaining its full accessible name", () => {
    render(<WorkspaceCrumbSelect />);

    const crumb = screen.getByRole("button", {
      name: "Overview: A long workspace name",
    });
    expect(crumb).toHaveClass("min-w-0", "max-w-32", "shrink");
    expect(screen.getByText("A long workspace name")).toHaveClass("truncate");
  });
});
