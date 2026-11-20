import { Button } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import ProjectLayoutControls, {
  projectViewFromPath,
} from "./project-layout-controls";

const permissionState = vi.hoisted(() => ({
  checking: true,
  canCreate: false,
}));
const featureState = vi.hoisted(() => ({
  cycles: false,
  modules: false,
  pages: false,
  calendar: true,
  timeline: true,
}));
const viewportState = vi.hoisted(() => ({ width: 1440 }));
const routerState = vi.hoisted(() => ({
  pathname: "/agent/projects/ENG/work",
  searchStr: "?q=urgent",
  navigate: vi.fn(),
}));
const activateWorkspaceMock = vi.hoisted(() =>
  vi.fn((_workspaceId: string) => Promise.resolve({ id: _workspaceId })),
);
const workspacesState = vi.hoisted(() => ({
  data: [
    { id: "workspace-1" },
    { id: "workspace-2" },
    { id: "workspace-a" },
    { id: "workspace-b" },
    { id: "workspace-active" },
  ] as Array<{ id: string }>,
}));
const toastError = vi.hoisted(() => vi.fn());
const mobileNavState = vi.hoisted(() => ({
  lastProps: null as Record<string, unknown> | null,
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
  return {
    ...actual,
    useIsMobile: (breakpoint = 768) => viewportState.width < breakpoint,
  };
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
  useProjectFeature: (_projectId: string, feature: string) =>
    feature === "feature.calendar"
      ? featureState.calendar
      : feature === "feature.timeline"
        ? featureState.timeline
        : false,
}));

const sessionState = vi.hoisted(() => ({
  activeOrganizationId: "workspace-1" as string | null,
  isPending: false,
}));
const projectsState = vi.hoisted(() => ({
  data: [
    { id: "project-1", workspaceId: "workspace-1", slug: "ENG" },
    { id: "project-2", workspaceId: "workspace-1", slug: "OPS" },
  ] as Array<{ id: string; workspaceId?: string; slug: string }>,
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: sessionState.activeOrganizationId
        ? {
            session: {
              activeOrganizationId: sessionState.activeOrganizationId,
            },
          }
        : { session: {} },
      isPending: sessionState.isPending,
    }),
  },
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: projectsState.data,
  }),
}));

vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({
    data: workspacesState.data,
  }),
}));

vi.mock("@/lib/activate-workspace-for-navigation", () => ({
  activateWorkspaceForNavigation: (workspaceId: string) =>
    activateWorkspaceMock(workspaceId),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    error: toastError,
  },
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

vi.mock("@/components/common/header/mobile-project-nav", () => ({
  default: (navProps: Record<string, unknown>) => {
    mobileNavState.lastProps = navProps;
    return <div data-testid="mobile-project-nav" />;
  },
}));

beforeEach(() => {
  viewportState.width = 1440;
  routerState.pathname = "/agent/projects/ENG/work";
  routerState.searchStr = "?q=urgent";
  routerState.navigate.mockReset();
  activateWorkspaceMock.mockReset();
  activateWorkspaceMock.mockImplementation((workspaceId: string) =>
    Promise.resolve({ id: workspaceId }),
  );
  toastError.mockReset();
  mobileNavState.lastProps = null;
  featureState.cycles = false;
  featureState.modules = false;
  featureState.pages = false;
  featureState.calendar = true;
  featureState.timeline = true;
  sessionState.activeOrganizationId = "workspace-1";
  sessionState.isPending = false;
  workspacesState.data = [
    { id: "workspace-1" },
    { id: "workspace-2" },
    { id: "workspace-a" },
    { id: "workspace-b" },
    { id: "workspace-active" },
  ];
  projectsState.data = [
    { id: "project-1", workspaceId: "workspace-1", slug: "ENG" },
    { id: "project-2", workspaceId: "workspace-1", slug: "OPS" },
  ];
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
      const timeline = screen.getByRole("button", { name: "Timeline" });
      fireEvent.focus(timeline);
      expect(reveal.mock.contexts).toEqual([timeline]);
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
    // U-14: the strip sizes to its tabs inside a slot that never drops below min-w-44, so
    // the widest tab keeps its 24 px scroll margin clear of the edge fade.
    const strip = screen.getByLabelText(
      translate("navigation:projectViews.workItems"),
    );
    expect(strip).toHaveClass("w-max", "max-w-full");
    expect(strip.parentElement).toHaveClass(
      "min-w-44",
      "flex-1",
      "contain-inline-size",
    );
    expect(screen.getByRole("button", { name: "Cycles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modules" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pages" })).toBeInTheDocument();
  });

  it("hides Calendar and Timeline while feature.calendar / feature.timeline are off (P4R1-M2)", () => {
    featureState.calendar = false;
    featureState.timeline = false;
    const { rerender } = render(
      <ProjectLayoutControls {...props} showViewSwitcher />,
    );
    expect(
      screen.queryByRole("button", {
        name: translate("navigation:projectViews.calendar"),
      }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Timeline" })).toBeNull();

    featureState.calendar = true;
    featureState.timeline = true;
    rerender(<ProjectLayoutControls {...props} showViewSwitcher />);
    expect(
      screen.getByRole("button", {
        name: translate("navigation:projectViews.calendar"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Timeline" }),
    ).toBeInTheDocument();
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

  it("opens the canonical /agent Calendar from the Calendar tab and keeps the view state", () => {
    render(<ProjectLayoutControls {...props} showViewSwitcher />);

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/agent/projects/ENG/calendar?q=urgent",
    });
  });

  it("falls back to Kaneo's calendar URL while the project key is unknown", () => {
    routerState.searchStr = "";
    render(
      <ProjectLayoutControls
        {...props}
        projectSlug={undefined}
        showViewSwitcher
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      to: "/dashboard/workspace/workspace-1/project/project-1/calendar",
    });
  });

  it("keeps calendar project switches on the canonical calendar route", () => {
    routerState.pathname = "/agent/projects/ENG/calendar";
    render(
      <ProjectLayoutControls
        {...props}
        activeView="calendar"
        showViewSwitcher
      />,
    );

    fireEvent.click(screen.getByTestId("switch-project"));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/agent/projects/OPS/calendar",
    });
  });

  it("moves a project switch made on the old dashboard calendar URL to the canonical calendar", () => {
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
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/agent/projects/OPS/calendar",
    });
  });

  it("keeps workspace identity on the ID-scoped calendar URL for a non-active workspace", () => {
    sessionState.activeOrganizationId = "workspace-active";
    projectsState.data = [
      { id: "project-1", workspaceId: "workspace-2", slug: "ENG" },
      { id: "project-2", workspaceId: "workspace-2", slug: "OPS" },
    ];
    routerState.pathname =
      "/dashboard/workspace/workspace-2/project/project-1/board";
    routerState.searchStr = "?q=urgent";

    const { rerender } = render(
      <ProjectLayoutControls
        {...props}
        workspaceId="workspace-2"
        activeView="board"
        showViewSwitcher
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/dashboard/workspace/workspace-2/project/project-1/calendar?q=urgent",
    });

    routerState.pathname =
      "/dashboard/workspace/workspace-2/project/project-1/calendar";
    rerender(
      <ProjectLayoutControls
        {...props}
        workspaceId="workspace-2"
        activeView="calendar"
        showViewSwitcher
      />,
    );

    fireEvent.click(screen.getByTestId("switch-project"));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
      params: { workspaceId: "workspace-2", projectId: "project-2" },
    });
  });

  it("keeps workspace and project identity on the ID-scoped calendar URL when a duplicate slug shadows the project", () => {
    projectsState.data = [
      { id: "project-1", workspaceId: "workspace-1", slug: "ENG" },
      { id: "shadow-eng", workspaceId: "workspace-1", slug: "ENG" },
      { id: "shadow-ops", workspaceId: "workspace-1", slug: "OPS" },
      { id: "project-2", workspaceId: "workspace-1", slug: "OPS" },
    ];
    routerState.pathname =
      "/dashboard/workspace/workspace-1/project/project-1/board";
    routerState.searchStr = "?q=urgent";

    const { rerender } = render(
      <ProjectLayoutControls {...props} activeView="board" showViewSwitcher />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Calendar" }));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/dashboard/workspace/workspace-1/project/project-1/calendar?q=urgent",
    });

    routerState.pathname =
      "/dashboard/workspace/workspace-1/project/project-1/calendar";
    rerender(
      <ProjectLayoutControls
        {...props}
        activeView="calendar"
        showViewSwitcher
      />,
    );

    fireEvent.click(screen.getByTestId("switch-project"));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      to: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
      params: { workspaceId: "workspace-1", projectId: "project-2" },
    });
  });

  it("places Overview first, before Backlog, and adds the Overview tabs", () => {
    featureState.pages = true;
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    const names = screen
      .getAllByRole("button")
      .map((button) => button.textContent)
      .filter((name) => name !== "Switch project");
    expect(names.slice(0, 3)).toEqual(["Overview", "Backlog", "Work items"]);
    expect(names.slice(-3)).toEqual(["Prerequisites", "Team", "Documents"]);

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/agent/projects/ENG",
    });
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/agent/projects/ENG/team",
    });
  });

  it("marks Overview current on the bare project URL and keeps the view on project switch", () => {
    routerState.pathname = "/agent/projects/ENG";
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    expect(screen.getByRole("button", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(screen.getByTestId("switch-project"));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/agent/projects/OPS",
    });
  });

  it("derives the view from old and new project URLs", () => {
    expect(projectViewFromPath("/agent/projects/ENG")).toBe("overview");
    expect(projectViewFromPath("/agent/projects/ENG/")).toBe("overview");
    expect(projectViewFromPath("/agent/projects/ENG/prerequisites")).toBe(
      "prerequisites",
    );
    expect(projectViewFromPath("/agent/projects/ENG/team")).toBe("team");
    expect(projectViewFromPath("/agent/projects/ENG/documents")).toBe(
      "documents",
    );
    expect(projectViewFromPath("/agent/projects/ENG/work")).toBe("board");
    expect(projectViewFromPath("/agent/projects/ENG/backlog")).toBe("backlog");
    expect(projectViewFromPath("/agent/projects/ENG/pages/p1")).toBe("pages");
    expect(projectViewFromPath("/dashboard/workspace/w/project/p/gantt")).toBe(
      "gantt",
    );
    expect(projectViewFromPath("/agent/projects/ENG/timeline")).toBe("gantt");
  });

  it("opens the canonical /agent Timeline and keeps it on project switch", () => {
    routerState.searchStr = "?q=urgent&item=ENG-7";
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("navigation:projectViews.timeline"),
      }),
    );
    const timelineHref: string =
      routerState.navigate.mock.calls.at(-1)?.[0].href;
    const timelineUrl = new URL(timelineHref, "https://ticketing.localhost");
    expect(timelineUrl.pathname).toBe("/agent/projects/ENG/timeline");
    expect(timelineUrl.searchParams.get("q")).toBe("urgent");
    // The schedule views keep the selected item as `taskId`, as Kaneo's Gantt did.
    expect(timelineUrl.searchParams.get("taskId")).toBe("ENG-7");
    expect(timelineUrl.searchParams.has("item")).toBe(false);

    routerState.pathname = "/agent/projects/ENG/timeline";
    cleanup();
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    expect(
      screen.getByRole("button", {
        name: translate("navigation:projectViews.timeline"),
      }),
    ).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByTestId("switch-project"));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/agent/projects/OPS/timeline",
    });
  });

  it("falls back to Kaneo's Gantt URL while the project key is unknown", () => {
    routerState.searchStr = "";
    render(
      <ProjectLayoutControls
        {...props}
        projectSlug={undefined}
        showViewSwitcher
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: translate("navigation:projectViews.timeline"),
      }),
    );
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      to: "/dashboard/workspace/workspace-1/project/project-1/gantt",
    });
  });
});

describe("ProjectLayoutControls tab strip overflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Lays the strip out at `frameWidth` px with every tab `tabWidth` px wide. */
  function layOutStrip(frameWidth: number, tabWidth = 100) {
    const original = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.slot === "scroll-area-viewport")
          return DOMRect.fromRect({
            x: 0,
            y: 0,
            width: frameWidth,
            height: 32,
          });
        const view = this.dataset.projectView;
        if (view) {
          const tabs = [
            ...(this.parentElement?.querySelectorAll<HTMLElement>(
              "[data-project-view]",
            ) ?? []),
          ];
          const index = tabs.indexOf(this);
          return DOMRect.fromRect({
            x: index * tabWidth,
            y: 0,
            width: tabWidth,
            height: 24,
          });
        }
        return original.call(this);
      },
    );
  }

  it("lists the tabs that do not fit in a More menu and navigates from it", async () => {
    featureState.cycles = false;
    featureState.modules = false;
    featureState.pages = false;
    layOutStrip(450);
    render(<ProjectLayoutControls {...props} showViewSwitcher />);

    const more = await screen.findByRole("button", {
      name: "More Project views",
    });
    expect(more).toHaveTextContent("More");
    fireEvent.click(more);
    const items = await screen.findAllByRole("menuitem");
    // Overview, Backlog, Work items and Calendar fit; the rest are listed.
    expect(items.map((item) => item.textContent)).toEqual([
      "Timeline",
      "Prerequisites",
      "Team",
      "Documents",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Documents" }));
    expect(routerState.navigate).toHaveBeenLastCalledWith({
      href: "/agent/projects/ENG/documents",
    });
    // Every tab stays in the strip, so the menu never changes its width.
    expect(
      screen.getByRole("button", { name: "Documents" }),
    ).toBeInTheDocument();
  });

  it("keeps the strip's slot at least as wide as the widest tab plus both fade margins", async () => {
    layOutStrip(450, 120);
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    const more = await screen.findByRole("button", {
      name: "More Project views",
    });
    const strip = screen.getByLabelText(
      translate("navigation:projectViews.workItems"),
    );
    // jsdom reorders the calc() terms, so each term is checked on its own.
    const minWidth = strip.parentElement?.style.minWidth ?? "";
    expect(minWidth).toMatch(/^calc\(/);
    expect(minWidth).toContain("120px");
    expect(minWidth).toContain("3rem");
    expect(minWidth).toContain("2px");
    // The "More" menu sits beside the slot, so its room is never taken from the strip.
    expect(strip.parentElement?.contains(more)).toBe(false);
  });

  it("shows no More menu when every tab fits", () => {
    layOutStrip(2000);
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    expect(
      screen.queryByRole("button", { name: "More Project views" }),
    ).toBeNull();
  });

  it("scrolls the strip sideways with a vertical wheel until it reaches an end", () => {
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    const viewport = screen
      .getByRole("button", { name: "Overview" })
      .closest<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (!viewport) throw new Error("no strip viewport");
    Object.defineProperty(viewport, "scrollWidth", { value: 900 });
    Object.defineProperty(viewport, "clientWidth", { value: 300 });

    const down = new WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      viewport.dispatchEvent(down);
    });
    expect(viewport.scrollLeft).toBe(120);
    expect(down.defaultPrevented).toBe(true);

    viewport.scrollLeft = 600;
    const pastEnd = new WheelEvent("wheel", {
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      viewport.dispatchEvent(pastEnd);
    });
    expect(pastEnd.defaultPrevented).toBe(false);

    const sideways = new WheelEvent("wheel", {
      deltaX: 50,
      deltaY: 10,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      viewport.dispatchEvent(sideways);
    });
    expect(sideways.defaultPrevented).toBe(false);
  });

  it("swaps the strip for the project menu below lg, including a 768 px tablet", async () => {
    viewportState.width = 768;
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    expect(await screen.findByTestId("mobile-project-nav")).toBeInTheDocument();
    const strip = screen.getByLabelText(
      translate("navigation:projectViews.workItems"),
    );
    // The strip's slot and the "More" menu share one wrapper that is hidden below lg.
    const stripGroup = strip.parentElement?.parentElement;
    expect(stripGroup).toHaveClass("hidden", "lg:flex");
    expect(stripGroup).not.toHaveClass("sm:block");
  });

  it("keeps the strip and no project menu at lg and wider", () => {
    viewportState.width = 1024;
    render(<ProjectLayoutControls {...props} showViewSwitcher />);
    expect(screen.queryByTestId("mobile-project-nav")).toBeNull();
  });

  it("activates a non-active workspace before opening slug-only project views across desktop tabs, overflow, and mobile handlers, and surfaces a toast on rejection", async () => {
    sessionState.activeOrganizationId = "workspace-a";
    projectsState.data = [
      { id: "project-1", workspaceId: "workspace-b", slug: "ENG" },
    ];
    featureState.cycles = true;
    featureState.modules = true;
    featureState.pages = true;
    viewportState.width = 768;
    layOutStrip(450);
    routerState.pathname =
      "/dashboard/workspace/workspace-b/project/project-1/calendar";
    routerState.searchStr = "";

    render(
      <ProjectLayoutControls
        {...props}
        workspaceId="workspace-b"
        activeView="calendar"
        showViewSwitcher
      />,
    );

    expect(await screen.findByTestId("mobile-project-nav")).toBeInTheDocument();
    expect(mobileNavState.lastProps?.slugViewsDisabledReason).toBeUndefined();

    for (const [label, expectedHref] of [
      ["Overview", "/agent/projects/ENG"],
      ["Cycles", "/agent/projects/ENG/cycles"],
      ["Modules", "/agent/projects/ENG/modules"],
      ["Pages", "/agent/projects/ENG/pages"],
      ["Prerequisites", "/agent/projects/ENG/prerequisites"],
      ["Team", "/agent/projects/ENG/team"],
      ["Documents", "/agent/projects/ENG/documents"],
    ] as const) {
      activateWorkspaceMock.mockClear();
      routerState.navigate.mockClear();

      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => {
        expect(activateWorkspaceMock).toHaveBeenCalledWith("workspace-b");
        expect(routerState.navigate).toHaveBeenCalledWith({
          href: expectedHref,
        });
      });
      expect(activateWorkspaceMock.mock.invocationCallOrder[0]).toBeLessThan(
        routerState.navigate.mock.invocationCallOrder[0],
      );
    }

    // Overflow menu item activates workspace-b before navigating.
    activateWorkspaceMock.mockClear();
    routerState.navigate.mockClear();
    fireEvent.click(
      await screen.findByRole("button", { name: "More Project views" }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Documents" }));
    await waitFor(() => {
      expect(activateWorkspaceMock).toHaveBeenCalledWith("workspace-b");
      expect(routerState.navigate).toHaveBeenCalledWith({
        href: "/agent/projects/ENG/documents",
      });
    });

    // Mobile handler activates workspace-b before navigating.
    activateWorkspaceMock.mockClear();
    routerState.navigate.mockClear();
    const onSelectOverview = mobileNavState.lastProps?.onSelectOverview as
      | (() => void)
      | undefined;
    expect(onSelectOverview).toBeTypeOf("function");
    onSelectOverview?.();
    await waitFor(() => {
      expect(activateWorkspaceMock).toHaveBeenCalledWith("workspace-b");
      expect(routerState.navigate).toHaveBeenCalledWith({
        href: "/agent/projects/ENG",
      });
    });

    // Rejected activation surfaces a translated error toast and stays on the current route.
    activateWorkspaceMock.mockClear();
    routerState.navigate.mockClear();
    activateWorkspaceMock.mockRejectedValueOnce(new Error("403 Forbidden"));
    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    await waitFor(() => {
      expect(activateWorkspaceMock).toHaveBeenCalledWith("workspace-b");
      expect(toastError).toHaveBeenCalledWith(
        translate("navigation:workspaceSwitcher.switchFailed"),
      );
    });
    expect(routerState.navigate).not.toHaveBeenCalled();
  });

  it("renders slug-only project controls disabled with a translated tooltip explanation when a shadowed slug cannot be resolved safely", async () => {
    projectsState.data = [
      { id: "shadow-eng", workspaceId: "workspace-1", slug: "ENG" },
      { id: "project-1", workspaceId: "workspace-1", slug: "ENG" },
    ];
    featureState.cycles = true;
    featureState.modules = true;
    featureState.pages = true;
    viewportState.width = 768;
    layOutStrip(450);
    routerState.pathname =
      "/dashboard/workspace/workspace-1/project/project-1/calendar";
    routerState.searchStr = "";

    const expectedReason = translate(
      "navigation:projectViews.shadowedKeyUnavailable",
    );

    render(
      <ProjectLayoutControls
        {...props}
        activeView="calendar"
        showViewSwitcher
      />,
    );

    expect(await screen.findByTestId("mobile-project-nav")).toBeInTheDocument();
    expect(mobileNavState.lastProps?.slugViewsDisabledReason).toBe(
      expectedReason,
    );

    for (const label of [
      "Overview",
      "Cycles",
      "Modules",
      "Pages",
      "Prerequisites",
      "Team",
      "Documents",
    ]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).toHaveAttribute("aria-description", expectedReason);
    }

    for (const label of ["Backlog", "Work items", "Calendar", "Timeline"]) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }

    fireEvent.click(screen.getByRole("button", { name: "Overview" }));
    expect(activateWorkspaceMock).not.toHaveBeenCalled();
    expect(routerState.navigate).not.toHaveBeenCalled();

    const overviewWrapper = document.querySelector<HTMLElement>(
      '[data-project-view="overview"]',
    );
    if (!overviewWrapper) throw new Error("missing overview wrapper");
    act(() => {
      overviewWrapper.focus();
    });
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      expectedReason,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "More Project views" }),
    );
    const overflowDocs = await screen.findByRole("menuitem", {
      name: "Documents",
    });
    expect(overflowDocs).toHaveAttribute("aria-disabled", "true");
    expect(overflowDocs).toHaveAttribute("aria-description", expectedReason);
    fireEvent.click(overflowDocs);
    expect(routerState.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
    act(() => overflowDocs.focus());
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      expectedReason,
    );
    fireEvent.keyDown(overflowDocs, { key: "Enter" });
    expect(routerState.navigate).not.toHaveBeenCalled();
    expect(overflowDocs).toBeInTheDocument();
  });
});
