import { SidebarMenu } from "@taskdesk/ui";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import SortableProjectList, {
  reorderErrorMessage,
} from "./nav-projects-sortable";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
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

describe("reorder failure toast", () => {
  it("falls back to the common error text, never the raw key, while the workspace namespace is missing", async () => {
    const { createInstance } = await import("i18next");
    const en = (await import("@i18n/en-US.json")).default;
    const instance = createInstance();
    await instance.init({
      lng: "en-US",
      resources: { "en-US": { common: en.common } },
      defaultNS: "common",
      interpolation: { escapeValue: false },
    });
    const missing = reorderErrorMessage(instance.t);
    expect(missing).toBe(en.common.error.messages.unknown);
    expect(missing).not.toContain("reorderError");
    instance.addResourceBundle("en-US", "workspace", en.workspace);
    expect(reorderErrorMessage(instance.t)).toBe(
      en.workspace.projects.reorderError,
    );
  });
});
