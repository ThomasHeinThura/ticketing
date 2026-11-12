import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Button } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectCalendarSearch } from "@/lib/project-board-search";
import { headingLevels } from "@/test/headings";
import { Route } from "./calendar";

type ProjectRecord = { id: string; workspaceId: string; slug: string };

const state = vi.hoisted(() => ({
  session: {
    data: { session: { activeOrganizationId: "workspace-1" } } as unknown,
    isPending: false,
  },
  project: {
    isLoading: false,
    isSuccess: true,
    isError: false,
    data: { id: "project-1", workspaceId: "workspace-1", slug: "RM" } as
      | ProjectRecord
      | undefined,
  },
  workspaceProjects: {
    isLoading: false,
    data: [{ id: "project-1", workspaceId: "workspace-1", slug: "RM" }] as
      | ProjectRecord[]
      | undefined,
  },
  calendarFeatureEnabled: true,
  renderedCalendar: vi.fn(),
  requestedProjectsWorkspaceId: [] as string[],
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: (defaultNamespace?: string | string[]) => ({
    t: (rawKey: string) =>
      typeof defaultNamespace === "string" && !rawKey.includes(":")
        ? `${defaultNamespace}:${rawKey}`
        : rawKey,
  }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => state.session,
  },
}));
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => state.project,
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: ({ workspaceId }: { workspaceId: string }) => {
    state.requestedProjectsWorkspaceId.push(workspaceId);
    return state.workspaceProjects;
  },
}));
// The real off state renders through ProjectViewFeatureGate; only its permission read is stubbed.
vi.mock("@/components/agile/use-can-manage-project-features", () => ({
  useCanManageProjectFeatures: () => false,
  useCanManageProjectFeaturesById: () => false,
}));
vi.mock("@/hooks/queries/feature-flag/use-project-pages-feature", () => ({
  useProjectFeatureState: () => state.calendarFeatureEnabled,
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({
    projectId,
    workspaceId,
    activeView,
    children,
  }: {
    projectId: string;
    workspaceId: string;
    activeView?: string;
    children: ReactNode;
  }) => (
    <div
      data-active-view={activeView}
      data-project-id={projectId}
      data-workspace-id={workspaceId}
    >
      {children}
    </div>
  ),
}));
vi.mock("@/components/common/layout", () => ({
  default: {
    Content: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
}));
vi.mock("@/components/calendar/project-calendar-view", () => ({
  default: ({
    projectId,
    workspaceId,
    search,
    onSearchChange,
  }: {
    projectId: string;
    workspaceId: string;
    search: ProjectCalendarSearch;
    onSearchChange: (
      update: (previous: ProjectCalendarSearch) => ProjectCalendarSearch,
      options?: { replace?: boolean },
    ) => void;
  }) => {
    state.renderedCalendar({ projectId, workspaceId, search });
    return (
      <div
        data-month={search.month ?? ""}
        data-project-id={projectId}
        data-testid="in-place-project-calendar"
        data-workspace-id={workspaceId}
      >
        <Button
          onClick={() =>
            onSearchChange((prev) => ({ ...prev, month: "2026-12" }), {
              replace: true,
            })
          }
          type="button"
        >
          next-month
        </Button>
      </div>
    );
  },
}));

function renderCalendarRouter(initialEntry: string) {
  const root = createRootRoute();
  const legacyCalendar = createRoute({
    getParentRoute: () => root,
    path: "/dashboard/workspace/$workspaceId/project/$projectId/calendar",
    validateSearch: Route.options.validateSearch,
    component: Route.options.component,
  });
  const canonicalCalendar = createRoute({
    getParentRoute: () => root,
    path: "/agent/projects/$projectKey/calendar",
    validateSearch: Route.options.validateSearch,
    component: () => <div data-testid="canonical-project-calendar" />,
  });
  const router = createRouter({
    routeTree: root.addChildren([legacyCalendar, canonicalCalendar]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });

  vi.spyOn(Route, "useParams").mockImplementation(
    () =>
      (router.state.matches.at(-1)?.params ?? {
        workspaceId: "",
        projectId: "",
      }) as { workspaceId: string; projectId: string },
  );
  vi.spyOn(Route, "useSearch").mockImplementation(
    () => router.state.location.search as ProjectCalendarSearch,
  );

  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  state.session = {
    data: { session: { activeOrganizationId: "workspace-1" } },
    isPending: false,
  };
  state.project = {
    isLoading: false,
    isSuccess: true,
    isError: false,
    data: { id: "project-1", workspaceId: "workspace-1", slug: "RM" },
  };
  state.workspaceProjects = {
    isLoading: false,
    data: [{ id: "project-1", workspaceId: "workspace-1", slug: "RM" }],
  };
  state.calendarFeatureEnabled = true;
  state.renderedCalendar.mockReset();
  state.requestedProjectsWorkspaceId = [];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("old Kaneo calendar URL", () => {
  it("redirects to /agent/projects/{key}/calendar with replace and preserves query and #hash when the project is in the active workspace", async () => {
    const router = renderCalendarRouter(
      "/dashboard/workspace/workspace-1/project/project-1/calendar?month=2026-10&q=urgent&taskId=RM-1#today",
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("canonical-project-calendar"),
      ).toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toBe("/agent/projects/RM/calendar");
    expect(router.state.location.searchStr).toBe(
      "?month=2026-10&q=urgent&taskId=RM-1",
    );
    expect(router.state.location.hash).toBe("today");
    expect(router.history.location.href).toBe(
      "/agent/projects/RM/calendar?month=2026-10&q=urgent&taskId=RM-1#today",
    );
    expect(router.history.length).toBe(1);
    expect(state.renderedCalendar).not.toHaveBeenCalled();
  });

  it("renders the calendar in place instead of redirecting when the project belongs to a non-active workspace", async () => {
    state.project = {
      isLoading: false,
      isSuccess: true,
      isError: false,
      data: { id: "project-2", workspaceId: "workspace-2", slug: "RM" },
    };

    const router = renderCalendarRouter(
      "/dashboard/workspace/workspace-2/project/project-2/calendar?month=2026-11#week-2",
    );

    const view = await screen.findByTestId("in-place-project-calendar");
    expect(view).toHaveAttribute("data-workspace-id", "workspace-2");
    expect(view).toHaveAttribute("data-project-id", "project-2");
    expect(view).toHaveAttribute("data-month", "2026-11");
    expect(router.history.location.href).toBe(
      "/dashboard/workspace/workspace-2/project/project-2/calendar?month=2026-11#week-2",
    );

    fireEvent.click(screen.getByText("next-month"));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ month: "2026-12" }),
    );
    expect(router.state.location.pathname).toBe(
      "/dashboard/workspace/workspace-2/project/project-2/calendar",
    );
  });

  it("respects the calendar feature gate when rendering in place for a non-active workspace", async () => {
    state.calendarFeatureEnabled = false;
    state.project = {
      isLoading: false,
      isSuccess: true,
      isError: false,
      data: { id: "project-2", workspaceId: "workspace-2", slug: "OPS" },
    };

    const router = renderCalendarRouter(
      "/dashboard/workspace/workspace-2/project/project-2/calendar",
    );

    expect(
      await screen.findByTestId("feature-off-calendar"),
    ).toBeInTheDocument();
    // The project shell has no h1, so the off state is the page's one h1.
    expect(headingLevels()).toEqual([1]);
    expect(router.state.location.pathname).toBe(
      "/dashboard/workspace/workspace-2/project/project-2/calendar",
    );
  });

  it("renders in place instead of redirecting to another project when a duplicate slug shadows the target in the active workspace", async () => {
    state.project = {
      isLoading: false,
      isSuccess: true,
      isError: false,
      data: { id: "project-2", workspaceId: "workspace-1", slug: "RM" },
    };
    state.workspaceProjects = {
      isLoading: false,
      data: [
        { id: "project-1", workspaceId: "workspace-1", slug: "RM" },
        { id: "project-2", workspaceId: "workspace-1", slug: "RM" },
      ],
    };

    const router = renderCalendarRouter(
      "/dashboard/workspace/workspace-1/project/project-2/calendar",
    );

    const view = await screen.findByTestId("in-place-project-calendar");
    expect(view).toHaveAttribute("data-project-id", "project-2");
    expect(router.state.location.pathname).toBe(
      "/dashboard/workspace/workspace-1/project/project-2/calendar",
    );
  });

  it("opens nothing while the project is still loading", async () => {
    state.project = {
      isLoading: true,
      isSuccess: false,
      isError: false,
      data: undefined,
    };

    const router = renderCalendarRouter(
      "/dashboard/workspace/workspace-1/project/project-1/calendar",
    );

    expect(
      await screen.findByText("workItems:legacyView.opening"),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      "/dashboard/workspace/workspace-1/project/project-1/calendar",
    );
    expect(state.renderedCalendar).not.toHaveBeenCalled();
  });

  it("never redirects or renders the calendar when the project record does not match the URL workspace", async () => {
    state.project = {
      isLoading: false,
      isSuccess: true,
      isError: false,
      data: { id: "project-1", workspaceId: "workspace-2", slug: "RM" },
    };

    const router = renderCalendarRouter(
      "/dashboard/workspace/workspace-1/project/project-1/calendar",
    );

    expect(
      await screen.findByText("workItems:legacyView.unavailable"),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      "/dashboard/workspace/workspace-1/project/project-1/calendar",
    );
    expect(state.renderedCalendar).not.toHaveBeenCalled();
  });

  it("shows the unavailable message when the project cannot be read", async () => {
    state.project = {
      isLoading: false,
      isSuccess: false,
      isError: true,
      data: undefined,
    };

    renderCalendarRouter(
      "/dashboard/workspace/workspace-1/project/project-1/calendar",
    );

    expect(
      await screen.findByText("workItems:legacyView.unavailable"),
    ).toBeInTheDocument();
    expect(state.renderedCalendar).not.toHaveBeenCalled();
  });
});
