import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outstandingCasesQuery } from "@/components/portal/cases/portal-outstanding-cases";
import useGetNotifications from "@/hooks/queries/notification/use-get-notifications";
import { portalProjectsOptions } from "@/hooks/queries/portal/portal-projects-options";
import {
  usePortalCases,
  usePortalHome,
} from "@/hooks/queries/portal/use-portal-cases";
import { projectOverviewOptions } from "@/hooks/queries/project/project-overview-options";
import { projectOptions } from "@/hooks/queries/project/use-get-project";
import useGetBoardWorkItems from "@/hooks/queries/work-item/use-get-board-work-items";
import portalClient from "@/query-client";
import { Route as inbox } from "@/routes/agent/_layout/_authenticated/agent/inbox";
import { Route as overview } from "@/routes/agent/_layout/_authenticated/agent/projects/$projectKey";
import { Route as backlog } from "@/routes/agent/_layout/_authenticated/agent/projects/$projectKey/backlog";
import { Route as portal } from "@/routes/portal/index";

const mocks = vi.hoisted(() => ({
  workspaces: vi.fn(),
  projects: vi.fn(),
  detail: vi.fn(),
  overview: vi.fn(),
  items: vi.fn(),
  searchItems: vi.fn(),
  notifications: vi.fn(),
  home: vi.fn(),
  cases: vi.fn(),
  portalProjects: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => options,
}));
vi.mock("@/fetchers/workspace/get-workspaces", () => ({
  default: mocks.workspaces,
}));
vi.mock("@/fetchers/project/get-projects", () => ({ default: mocks.projects }));
vi.mock("@/fetchers/project/get-project", () => ({ default: mocks.detail }));
vi.mock("@/fetchers/project/overview", async (original) => ({
  ...(await original<typeof import("@/fetchers/project/overview")>()),
  getProjectOverview: mocks.overview,
}));
vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: mocks.items,
}));
vi.mock("@/fetchers/work-item/search-work-items", () => ({
  default: mocks.searchItems,
}));
vi.mock("@/fetchers/notification/get-notifications", () => ({
  default: mocks.notifications,
}));
vi.mock("@/fetchers/portal/cases", async (original) => ({
  ...(await original<typeof import("@/fetchers/portal/cases")>()),
  getPortalHome: mocks.home,
  getPortalCases: mocks.cases,
}));
vi.mock("@/fetchers/portal/projects", async (original) => {
  const actual = await original<typeof import("@/fetchers/portal/projects")>();
  return { ...actual, getPortalProjects: mocks.portalProjects };
});

function loader(route: unknown, args: object) {
  return (route as { loader: (args: never) => unknown }).loader(args as never);
}
const session = { session: { activeOrganizationId: "ws" } };
const context = (queryClient: QueryClient) => ({ queryClient, session });
const wrapper =
  (client: QueryClient) =>
  ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  portalClient.clear();
  mocks.workspaces.mockResolvedValue([{ id: "ws" }]);
  mocks.projects.mockResolvedValue([
    { id: "p1", slug: "OPS", workspaceId: "ws" },
  ]);
  mocks.detail.mockResolvedValue({ id: "p1" });
  mocks.overview.mockResolvedValue({});
  mocks.items.mockResolvedValue({ items: [], hasMore: false });
  mocks.searchItems.mockResolvedValue({ items: [], hasMore: false });
  mocks.notifications.mockResolvedValue({ data: [], unreadCount: 0 });
  mocks.home.mockResolvedValue({});
  mocks.cases.mockResolvedValue({});
  mocks.portalProjects.mockResolvedValue({ data: [] });
});
afterEach(() => {
  cleanup();
  client.clear();
  portalClient.clear();
});

describe("route entry reads", () => {
  it("starts overview reads without blocking and reuses them on mount", async () => {
    expect(
      loader(overview, {
        context: context(client),
        params: { projectKey: "OPS" },
        cause: "enter",
        location: { pathname: "/agent/projects/OPS" },
      }),
    ).toBeUndefined();
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1));
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    renderHook(
      () => {
        useQuery(projectOptions("p1", "ws"));
        useQuery(projectOverviewOptions("p1"));
      },
      { wrapper: wrapper(client) },
    );
    expect(mocks.detail).toHaveBeenCalledTimes(1);
    expect(mocks.overview).toHaveBeenCalledTimes(1);
  });
  it("starts the backlog read without blocking and reuses it on mount", async () => {
    expect(
      loader(backlog, {
        context: context(client),
        params: { projectKey: "OPS" },
        deps: {},
        cause: "enter",
      }),
    ).toBeUndefined();
    await waitFor(() => expect(mocks.items).toHaveBeenCalledTimes(1));
    renderHook(
      () =>
        useGetBoardWorkItems({
          projectId: "p1",
          projectSlug: "OPS",
          workspaceId: "ws",
          realtimeStatus: "connecting",
        }),
      { wrapper: wrapper(client) },
    );
    expect(mocks.items).toHaveBeenCalledTimes(1);
  });
  it("starts inbox reads without blocking and reuses them on mount", async () => {
    expect(
      loader(inbox, {
        context: context(client),
        deps: { filter: "unread" },
        cause: "enter",
      }),
    ).toBeUndefined();
    await waitFor(() => expect(mocks.notifications).toHaveBeenCalledTimes(1));
    renderHook(() => useGetNotifications("unread"), {
      wrapper: wrapper(client),
    });
    expect(mocks.notifications).toHaveBeenCalledTimes(1);
  });
  it("starts portal dashboard reads without blocking and reuses them on mount", async () => {
    const deps = { project: "OPS", scope: "all" as const };
    expect(
      loader(portal, { context: { portalUserId: "u1" }, deps, cause: "enter" }),
    ).toBeUndefined();
    await waitFor(() => expect(mocks.home).toHaveBeenCalledTimes(1));
    expect(mocks.cases).toHaveBeenCalledTimes(1);
    expect(mocks.portalProjects).toHaveBeenCalledTimes(1);
    renderHook(
      () => {
        usePortalHome("u1", "OPS", true);
        usePortalCases("u1", outstandingCasesQuery(deps, "OPS"), {
          prefetched: true,
        });
        useQuery(portalProjectsOptions());
      },
      { wrapper: wrapper(portalClient) },
    );
    expect(mocks.home).toHaveBeenCalledTimes(1);
    expect(mocks.cases).toHaveBeenCalledTimes(1);
    expect(mocks.portalProjects).toHaveBeenCalledTimes(1);
  });
  it("starts filtered backlog search with the same options as the screen", async () => {
    expect(
      loader(backlog, {
        context: context(client),
        params: { projectKey: "OPS" },
        deps: { filter: "priority = high" },
        cause: "enter",
      }),
    ).toBeUndefined();
    await waitFor(() => expect(mocks.searchItems).toHaveBeenCalledTimes(1));
    renderHook(
      () =>
        useGetBoardWorkItems({
          projectId: "p1",
          projectSlug: "OPS",
          workspaceId: "ws",
          filter: "priority = high",
          realtimeStatus: "connecting",
        }),
      { wrapper: wrapper(client) },
    );
    expect(mocks.searchItems).toHaveBeenCalledTimes(1);
  });
  it("does not await an unresolved inbox request", () => {
    mocks.notifications.mockReturnValue(new Promise(() => {}));
    expect(
      loader(inbox, {
        context: context(client),
        deps: { filter: "all" },
        cause: "enter",
      }),
    ).toBeUndefined();
    expect(mocks.notifications).toHaveBeenCalledTimes(1);
  });
  it("does not start reads for hover or a disabled portal", () => {
    loader(inbox, {
      context: context(client),
      deps: { filter: "all" },
      cause: "preload",
    });
    loader(backlog, {
      context: context(client),
      params: { projectKey: "OPS" },
      deps: {},
      cause: "preload",
    });
    loader(overview, {
      context: context(client),
      params: { projectKey: "OPS" },
      cause: "preload",
      location: { pathname: "/agent/projects/OPS" },
    });
    loader(portal, {
      context: { portalUserId: "u1", portalState: "off" },
      deps: {},
      cause: "enter",
    });
    expect(mocks.workspaces).not.toHaveBeenCalled();
    expect(mocks.notifications).not.toHaveBeenCalled();
    expect(mocks.home).not.toHaveBeenCalled();
  });
});

it("refreshes the overview when returning from a child route", async () => {
  const {
    createMemoryHistory,
    createRootRouteWithContext,
    createRoute,
    createRouter,
  } = await import("@tanstack/react-router");
  const root = createRootRouteWithContext<{
    queryClient: QueryClient;
    session: typeof session;
  }>()();
  const options = overview as unknown as {
    loader: (args: never) => unknown;
    beforeLoad: (args: never) => unknown;
  };
  const projectRoute = createRoute({
    getParentRoute: () => root,
    path: "/agent/projects/$projectKey",
    beforeLoad: (args) => options.beforeLoad(args as never),
    loader: (args) => options.loader(args as never),
  });
  const child = createRoute({
    getParentRoute: () => projectRoute,
    path: "backlog",
  });
  const router = createRouter({
    routeTree: root.addChildren([projectRoute.addChildren([child])]),
    history: createMemoryHistory({
      initialEntries: ["/agent/projects/OPS/backlog"],
    }),
    context: context(client),
  });
  await router.load();
  expect(mocks.overview).not.toHaveBeenCalled();
  await router.navigate({
    to: "/agent/projects/$projectKey",
    params: { projectKey: "OPS" },
  });
  await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1));
});
