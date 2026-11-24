import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const resolver = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/project/resolve-project-key", () => ({
  default: resolver,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws_1" }, isLoading: false }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [{ id: "p1", slug: "NEWK", workspaceId: "ws_1" }],
    isLoading: false,
  }),
}));

import { Route } from "./$projectKey";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resolver.mockReset();
});

function mount(url: string) {
  vi.spyOn(Route, "useParams").mockImplementation(
    () => useParams({ strict: false }) as never,
  );
  const root = createRootRoute();
  const layout = createRoute({
    getParentRoute: () => root,
    path: "/agent/projects/$projectKey",
    component: Route.options.component,
  });
  const work = createRoute({
    getParentRoute: () => layout,
    path: "work",
    component: () => <div data-testid="work" />,
  });
  const router = createRouter({
    routeTree: root.addChildren([layout.addChildren([work])]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

describe("project route after a rename (#1200)", () => {
  it("replaces the old key with the current one and keeps the path, search and hash", async () => {
    resolver.mockResolvedValue("NEWK");
    const router = mount("/agent/projects/OLDK/work?view=board&q=x#row-2");
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/agent/projects/NEWK/work"),
    );
    expect(router.state.location.searchStr).toBe("?view=board&q=x");
    expect(router.state.location.hash).toBe("row-2");
    expect(resolver).toHaveBeenCalledWith({ workspaceId: "ws_1", key: "OLDK" });
  });

  it("stays put and asks nothing when the key is a live project", async () => {
    const router = mount("/agent/projects/NEWK/work");
    await waitFor(() => expect(router.state.status).toBe("idle"));
    expect(router.state.location.pathname).toBe("/agent/projects/NEWK/work");
    expect(resolver).not.toHaveBeenCalled();
  });

  it("stays put when the resolver refuses the key", async () => {
    resolver.mockResolvedValue(null);
    const router = mount("/agent/projects/NOPE/work?view=board");
    await waitFor(() => expect(resolver).toHaveBeenCalled());
    await new Promise((done) => setTimeout(done, 20));
    expect(router.state.location.pathname).toBe("/agent/projects/NOPE/work");
  });
});
