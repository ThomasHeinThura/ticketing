import { SidebarMenu } from "@taskdesk/ui";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import SortableProjectList from "./nav-projects-sortable";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));

vi.mock("@/hooks/mutations/project/use-reorder-projects", () => ({
  default: () => vi.fn(),
}));

const projects = [
  { id: "project-1", name: "Alpha" },
  { id: "project-2", name: "Beta" },
] as Parameters<typeof SortableProjectList>[0]["projects"];

// Rendered trees are unmounted by the shared afterEach(cleanup) in src/test/setup.ts.

describe("SortableProjectList accessibility", () => {
  it("keeps the sidebar menu list limited to list items", () => {
    const { container } = render(
      <SidebarMenu>
        <SortableProjectList
          projects={projects}
          workspaceId="workspace-1"
          renderProjectContents={(project) => <span>{project.name}</span>}
        />
      </SidebarMenu>,
    );

    const menu = container.querySelector("ul");
    if (!menu) throw new Error("Expected the sidebar menu list.");
    expect(menu.children).toHaveLength(2);
    expect(Array.from(menu.children).map((child) => child.tagName)).toEqual([
      "LI",
      "LI",
    ]);
  });

  it("still announces drag instructions, outside the list", () => {
    const { container } = render(
      <SidebarMenu>
        <SortableProjectList
          projects={projects}
          workspaceId="workspace-1"
          renderProjectContents={(project) => <span>{project.name}</span>}
        />
      </SidebarMenu>,
    );

    const menu = container.querySelector("ul");
    const liveRegion = document.body.querySelector('[role="status"]');
    expect(liveRegion).not.toBeNull();
    expect(menu?.contains(liveRegion)).toBe(false);
  });
});
