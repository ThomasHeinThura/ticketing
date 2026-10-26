import { Button } from "@taskdesk/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import ProjectLayoutControls from "./project-layout-controls";

const permissionState = vi.hoisted(() => ({
  checking: true,
  canCreate: false,
}));
const featureState = vi.hoisted(() => ({
  cycles: false,
  modules: false,
  pages: false,
}));
const routerState = vi.hoisted(() => ({
  pathname: "/agent/projects/ENG/work",
  searchStr: "?q=urgent",
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useLocation: () => ({
      pathname: routerState.pathname,
      searchStr: routerState.searchStr,
    }),
    useNavigate: () => routerState.navigate,
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));

vi.mock("@taskdesk/ui", async () => {
  const actual =
    await vi.importActual<typeof import("@taskdesk/ui")>("@taskdesk/ui");
  return { ...actual, useIsMobile: () => false };
});

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: permissionState.checking,
    canCreateProjects: () => permissionState.canCreate,
  }),
}));

vi.mock("@/hooks/queries/agile/use-agile-features", () => ({
  default: () => ({
    features: {
      cycles: featureState.cycles,
      modules: featureState.modules,
      estimates: false,
    },
  }),
}));

vi.mock("@/hooks/queries/feature-flag/use-project-pages-feature", () => ({
  default: () => featureState.pages,
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [
      { id: "project-1", slug: "ENG" },
      { id: "project-2", slug: "OPS" },
    ],
  }),
}));

vi.mock("@/components/common/header/project-crumb-select", () => ({
  default: ({
    onAddProject,
    onSelectProject,
  }: {
    onAddProject?: () => void;
    onSelectProject: (projectId: string) => void;
  }) => (
    <div
      data-testid="project-crumb"
      data-add-project-enabled={String(Boolean(onAddProject))}
    >
      <Button
        data-testid="switch-project"
        onClick={() => onSelectProject("project-2")}
        type="button"
      >
        Switch project
      </Button>
    </div>
  ),
}));

const props = {
  projectId: "project-1",
  workspaceId: "workspace-1",
  projectName: "Project One",
  projectSlug: "ENG",
  showViewSwitcher: false,
  onAddProject: vi.fn(),
};

beforeEach(() => {
  routerState.pathname = "/agent/projects/ENG/work";
  routerState.searchStr = "?q=urgent";
  routerState.navigate.mockReset();
});

describe("ProjectLayoutControls permissions", () => {
  it("reveals the current view when a constrained tab strip changes routes", () => {
    featureState.cycles = true;
    featureState.modules = true;
    featureState.pages = true;
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const reveal = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: reveal,
    });
    try {
      const { rerender } = render(
        <ProjectLayoutControls
          {...props}
          showViewSwitcher
          activeView="cycles"
        />,
      );
      const cycles = screen.getByRole("button", { name: "Cycles" });
      expect(cycles).toHaveAttribute("aria-current", "page");
      expect(reveal.mock.contexts).toContain(cycles);
      rerender(
        <ProjectLayoutControls
          {...props}
          showViewSwitcher
          activeView="pages"
        />,
      );
      const pages = screen.getByRole("button", { name: "Pages" });
      expect(pages).toHaveAttribute("aria-current", "page");
      expect(cycles).not.toHaveAttribute("aria-current");
      expect(reveal.mock.contexts).toContain(pages);
      // A focused tab must be revealed immediately, even before it becomes
      // the current route; native focus scrolling left Gantt clipped at 768px.
      reveal.mockClear();
      const gantt = screen.getByRole("button", { name: "Gantt" });
      fireEvent.focus(gantt);
      expect(reveal.mock.contexts).toEqual([gantt]);
      expect(reveal).toHaveBeenCalledWith({
        block: "nearest",
        inline: "nearest",
      });
      expect(pages).toHaveAttribute("aria-current", "page");
      expect(routerState.navigate).not.toHaveBeenCalled();
    } finally {
      if (original)
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          original,
        );
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });
  it("does not expose Add Project while the permission check is pending", () => {
    permissionState.checking = true;
    permissionState.canCreate = true;

    render(<ProjectLayoutControls {...props} />);

    expect(screen.getByTestId("project-crumb")).toHaveAttribute(
      "data-add-project-enabled",
      "false",
    );
  });

  it("exposes Add Project only after the capability check allows it", () => {
    permissionState.checking = false;
    permissionState.canCreate = false;
    const { rerender } = render(<ProjectLayoutControls {...props} />);

    expect(screen.getByTestId("project-crumb")).toHaveAttribute(
      "data-add-project-enabled",
      "false",
    );

    permissionState.canCreate = true;
    rerender(<ProjectLayoutControls {...props} />);
    expect(screen.getByTestId("project-crumb")).toHaveAttribute(
      "data-add-project-enabled",
      "true",
    );
  });

  it("renders feature tabs from the deferred controls' resolved feature flags", () => {
    featureState.cycles = false;
    featureState.modules = false;
    featureState.pages = false;
    const { rerender } = render(
      <ProjectLayoutControls {...props} showViewSwitcher />,
    );
    expect(screen.queryByRole("button", { name: "Cycles" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Modules" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pages" })).toBeNull();

    featureState.cycles = true;
    featureState.modules = true;
    featureState.pages = true;
    rerender(<ProjectLayoutControls {...props} showViewSwitcher />);
    expect(
      screen.getByLabelText(translate("navigation:projectViews.workItems")),
    ).toHaveClass("min-w-0", "shrink");
    expect(screen.getByRole("button", { name: "Cycles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modules" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pages" })).toBeInTheDocument();
  });

  it("preserves work-view navigation state and routes project switches by the active view", () => {
    render(<ProjectLayoutControls {...props} showViewSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(routerState.navigate).toHaveBeenCalledWith({
      href: expect.stringMatching(
        /^\/dashboard\/workspace\/workspace-1\/project\/project-1\/backlog\?q=urgent$/,
      ),
    });

    fireEvent.click(screen.getByTestId("switch-project"));
    const lastNavigation = routerState.navigate.mock.calls.at(-1)?.[0];
    expect(lastNavigation.href).toContain("/agent/projects/OPS/work");
    expect(lastNavigation.href).toContain("layout=board");
  });

  it("keeps dashboard calendar project switches on the dashboard calendar route", () => {
    routerState.pathname =
      "/dashboard/workspace/workspace-1/project/project-1/calendar";
    render(
      <ProjectLayoutControls
        {...props}
        activeView="calendar"
        showViewSwitcher
      />,
    );

    fireEvent.click(screen.getByTestId("switch-project"));
    expect(routerState.navigate).toHaveBeenCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
      params: { workspaceId: "workspace-1", projectId: "project-2" },
    });
  });
});
