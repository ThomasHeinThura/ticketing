import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const state = vi.hoisted(() => ({
  projects: [] as Array<Record<string, unknown>> | undefined,
  projectsError: false,
  backlogItems: [] as Array<Record<string, unknown>>,
  backlogLoading: false,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
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
    isLoading: state.backlogLoading,
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

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "user-1" } }),
}));
const settings = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/fetchers/user-settings/user-settings", () => ({
  getUserSettings: settings.load,
  patchUserSettings: vi.fn(),
}));

import { Route as WorkRoute } from "./work";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(path: string, destination: Promise<void>) {
  const root = createRootRoute({
    component: () => (
      <>
        <Link to="/agent/service-management/services">Catalogue</Link>
        <Outlet />
      </>
    ),
  });
  const work = WorkRoute.update({
    id: "/_layout/_authenticated/agent/projects/$projectKey/work",
    path: "/agent/projects/$projectKey/work",
    getParentRoute: () => root,
    beforeLoad: undefined,
    loader: undefined,
  } as never);
  const catalogue = createRoute({
    getParentRoute: () => root,
    path: "/agent/service-management/services",
    loader: () => destination,
    component: () => <div>Catalogue destination</div>,
  });
  const router = createRouter({
    routeTree: root.addChildren([work, catalogue]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultPendingMs: 100000,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return { router, queryClient };
}

beforeEach(() => {
  state.projects = [
    { id: "proj_1", slug: "SUP", name: "Wallop", workspaceId: "ws_1" },
  ];
  window.localStorage.clear();
  settings.load.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("does not restore when catalogue navigation is pending", async () => {
  const preference = deferred<{ settings: Record<string, string> }>();
  const destination = deferred<void>();
  settings.load.mockReturnValue(preference.promise);
  const { router, queryClient } = setup(
    "/agent/projects/SUP/work",
    destination.promise,
  );
  await screen.findByTestId("panel");
  expect(queryClient.getQueryState(["user-settings", "user-1"])?.status).toBe(
    "pending",
  );
  const navigate = vi.spyOn(router, "buildAndCommitLocation");
  fireEvent.click(screen.getByRole("link", { name: "Catalogue" }));
  await waitFor(() => expect(router.state.status).toBe("pending"));
  expect(router.latestLocation.pathname).toBe(
    "/agent/service-management/services",
  );
  expect(screen.getByTestId("panel")).toBeInTheDocument();
  await act(async () => {
    preference.resolve({ settings: { "layout.proj_1": "table" } });
    await preference.promise;
    await waitFor(() =>
      expect(
        queryClient.getQueryState(["user-settings", "user-1"])?.status,
      ).toBe("success"),
    );
  });
  expect(screen.getByTestId("panel")).toBeInTheDocument();
  expect(navigate).toHaveBeenCalledTimes(1);
  await act(async () => {
    destination.resolve();
    await destination.promise;
  });
  await screen.findByText("Catalogue destination");
  expect(router.state.location.pathname).toBe(
    "/agent/service-management/services",
  );
});

it("restores a saved layout on a trailing-slash work URL", async () => {
  settings.load.mockResolvedValue({ settings: { "layout.proj_1": "table" } });
  const { router } = setup("/agent/projects/SUP/work/", Promise.resolve());
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({ layout: "table" }),
  );
});

it("preserves an explicit layout", async () => {
  settings.load.mockResolvedValue({ settings: { "layout.proj_1": "table" } });
  const { router, queryClient } = setup(
    "/agent/projects/SUP/work?layout=list",
    Promise.resolve(),
  );
  await screen.findByTestId("panel");
  await waitFor(() =>
    expect(queryClient.getQueryState(["user-settings", "user-1"])?.status).toBe(
      "success",
    ),
  );
  await act(async () => {});
  expect(router.state.location.search).toMatchObject({ layout: "list" });
});
