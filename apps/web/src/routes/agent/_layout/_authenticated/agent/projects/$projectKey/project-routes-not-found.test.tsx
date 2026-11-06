import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const state = vi.hoisted(() => ({
  projects: [] as Array<Record<string, unknown>> | undefined,
  projectsError: false,
  backlogItems: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));
vi.mock("@/hooks/use-project-view-preference", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/use-project-view-preference")
  >()),
  useProjectViewPreference: () => ({
    value: undefined,
    set: vi.fn(),
    settled: true,
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/work-item/work-item-create-trigger", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-create-dialog-shell", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-selection-toggle", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-list-loading", () => ({
  default: () => <div data-testid="list-loading" />,
}));
vi.mock("@/fetchers/custom-field", () => ({
  getCustomFields: () =>
    Promise.resolve({ data: [], meta: { total: 0, manyFieldsWarning: false } }),
}));
vi.mock("@/components/work-item/work-items-panel", () => ({
  default: (props: { isError?: boolean }) => (
    <div data-testid="panel" data-error={String(Boolean(props.isError))} />
  ),
}));
vi.mock("@/components/work-item/work-item-board-view", () => ({
  default: () => <div data-testid="board" />,
}));
vi.mock("@/components/work-item/work-item-list-controls", () => ({
  default: () => null,
}));
vi.mock("@/lib/i18n/after-first-paint", () => ({
  afterFirstPaint: () => new Promise(() => {}),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws_1" }, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: state.projects,
    isLoading: false,
    isPending: false,
    isError: state.projectsError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-items", () => ({
  default: () => ({
    data: { items: [], hasPartialFailure: false, hasMore: false },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-board-work-items", () => ({
  default: () => ({
    data: { pages: [{ items: state.backlogItems }] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canRankTasks: () => true,
  }),
}));

import { Route as BacklogRoute } from "./backlog";
import { Route as WorkRoute } from "./work";

/** Renders inside a real router so the not-found state's link has a router to resolve against. */
function renderInRouter(children: ReactNode) {
  const rootRoute = createRootRoute({ component: () => <>{children}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

function stubRoute(
  route: typeof WorkRoute | typeof BacklogRoute,
  projectKey: string,
  search: Record<string, unknown>,
) {
  vi.spyOn(route, "useParams").mockReturnValue({ projectKey } as never);
  vi.spyOn(route, "useSearch").mockReturnValue(search as never);
  vi.spyOn(route, "useNavigate").mockReturnValue(vi.fn() as never);
}

const NOT_FOUND = "This Project does not exist or is out of reach.";

beforeEach(() => {
  state.projects = [
    { id: "proj_1", slug: "WLP", name: "Wallop", workspaceId: "ws_1" },
  ];
  state.projectsError = false;
  state.backlogItems = [];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Work items route for a missing or out-of-reach Project", () => {
  it("shows the not-found denial, not the toolbar and a Retry load error", async () => {
    stubRoute(WorkRoute, "NOPE", { layout: "list", sort: "key", dir: "asc" });
    const Component = WorkRoute.options.component as () => React.JSX.Element;
    renderInRouter(<Component />);

    const denial = await screen.findByTestId("project-not-found");
    expect(denial).toHaveTextContent(NOT_FOUND);
    // The denial is the primary content, so the sidebar and selector need not wait.
    expect(denial).toHaveAttribute("data-primary-content-ready", "true");
    expect(
      within(denial).getByRole("link", { name: "Back to Projects" }),
    ).toHaveAttribute("href", "/agent");
    expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("keeps the Retry path when the Project list itself failed to load", async () => {
    state.projects = undefined;
    state.projectsError = true;
    stubRoute(WorkRoute, "WLP", { layout: "list", sort: "key", dir: "asc" });
    const Component = WorkRoute.options.component as () => React.JSX.Element;
    renderInRouter(<Component />);

    expect(await screen.findByTestId("panel")).toHaveAttribute(
      "data-error",
      "true",
    );
    expect(screen.queryByTestId("project-not-found")).toBeNull();
  });
});

describe("Backlog route", () => {
  it("shows the not-found denial for a missing Project instead of an empty backlog", async () => {
    stubRoute(BacklogRoute, "NOPE", {});
    const Component = BacklogRoute.options.component as () => React.JSX.Element;
    renderInRouter(<Component />);

    expect(await screen.findByTestId("project-not-found")).toHaveTextContent(
      NOT_FOUND,
    );
    expect(screen.queryByTestId("backlog-empty")).toBeNull();
    expect(screen.queryByTestId("project-backlog-page")).toBeNull();
  });

  it("labels a missing priority and names the state on the reorder buttons", async () => {
    state.backlogItems = [
      {
        id: "id-1",
        key: "WLP-1",
        title: "First",
        priority: null,
        stateId: "s1",
        stateName: "Todo",
        stateCategory: "unstarted",
        position: "1.0",
        unavailableFields: [],
      },
      {
        id: "id-2",
        key: "WLP-2",
        title: "Second",
        priority: "high",
        stateId: "s1",
        stateName: "Todo",
        stateCategory: "unstarted",
        position: "2.0",
        unavailableFields: [],
      },
    ];
    stubRoute(BacklogRoute, "WLP", {});
    const Component = BacklogRoute.options.component as () => React.JSX.Element;
    renderInRouter(<Component />);

    const first = await screen.findByTestId("backlog-row-WLP-1");
    expect(first).toHaveTextContent("No priority");
    expect(first).not.toHaveTextContent("priority.null");
    expect(screen.getByTestId("backlog-row-WLP-2")).toHaveTextContent("High");
    expect(screen.getByTestId("backlog-move-down-WLP-1")).toHaveAccessibleName(
      "Move down: WLP-1 in Todo",
    );
    expect(screen.getByTestId("backlog-move-up-WLP-2")).toHaveAccessibleName(
      "Move up: WLP-2 in Todo",
    );
  });
});
