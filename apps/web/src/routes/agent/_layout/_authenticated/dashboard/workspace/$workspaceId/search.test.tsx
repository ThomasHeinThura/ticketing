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
import type { AgentGlobalSearch } from "@/lib/routes";
import { Route } from "./search";

const state = vi.hoisted(() => ({
  session: {
    data: { session: { activeOrganizationId: "ws-active" } } as unknown,
    isPending: false,
  },
  workspaces: {
    data: [
      { id: "ws-active", name: "Active Workspace" },
      { id: "ws-other", name: "Other Workspace" },
    ] as Array<{ id: string; name: string }> | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  renderedWorkspaceSearch: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/common/workspace-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({
  default: () => null,
}));
vi.mock("@/components/errors/error-display", () => ({
  ErrorDisplay: ({ onRetry }: { onRetry?: () => void }) => (
    <Button
      data-testid="workspace-search-error"
      onClick={onRetry}
      type="button"
    >
      retry
    </Button>
  ),
}));
vi.mock("@/components/search/workspace-search", () => ({
  default: ({
    workspaceId,
    search,
    onSearchChange,
  }: {
    workspaceId: string;
    search: AgentGlobalSearch;
    onSearchChange: (next: AgentGlobalSearch) => void;
  }) => {
    state.renderedWorkspaceSearch({ workspaceId, search });
    return (
      <div
        data-q={search.q ?? ""}
        data-scope={search.scope ?? ""}
        data-testid="scoped-workspace-search"
        data-workspace-id={workspaceId}
      >
        <Button
          onClick={() => onSearchChange({ q: "updated", scope: "work-items" })}
          type="button"
        >
          change-search
        </Button>
      </div>
    );
  },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => state.session,
  },
}));
vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => state.workspaces,
}));

function renderSearchRouter(initialEntry: string) {
  const root = createRootRoute();
  const legacySearch = createRoute({
    getParentRoute: () => root,
    path: "/dashboard/workspace/$workspaceId/search",
    validateSearch: Route.options.validateSearch,
    component: Route.options.component,
  });
  const canonicalSearch = createRoute({
    getParentRoute: () => root,
    path: "/agent/search",
    validateSearch: Route.options.validateSearch,
    component: () => <div data-testid="canonical-agent-search" />,
  });
  const router = createRouter({
    routeTree: root.addChildren([legacySearch, canonicalSearch]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });

  vi.spyOn(Route, "useParams").mockImplementation(
    () =>
      (router.state.matches.at(-1)?.params ?? {
        workspaceId: "",
      }) as { workspaceId: string },
  );
  vi.spyOn(Route, "useSearch").mockImplementation(
    () => router.state.location.search as AgentGlobalSearch,
  );

  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  state.session = {
    data: { session: { activeOrganizationId: "ws-active" } },
    isPending: false,
  };
  state.workspaces = {
    data: [
      { id: "ws-active", name: "Active Workspace" },
      { id: "ws-other", name: "Other Workspace" },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
  state.renderedWorkspaceSearch.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("old workspace search URL /dashboard/workspace/{id}/search", () => {
  it("redirects to /agent/search with replace and preserves query and #hash when {id} is the active accessible workspace", async () => {
    const router = renderSearchRouter(
      "/dashboard/workspace/ws-active/search?q=HELP-24&scope=projects#results",
    );

    await waitFor(() =>
      expect(screen.getByTestId("canonical-agent-search")).toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toBe("/agent/search");
    expect(router.state.location.search).toEqual({
      q: "HELP-24",
      scope: "projects",
    });
    expect(router.state.location.hash).toBe("results");
    expect(router.history.location.href).toBe(
      "/agent/search?q=HELP-24&scope=projects#results",
    );
    expect(router.history.length).toBe(1);
    expect(state.renderedWorkspaceSearch).not.toHaveBeenCalled();
  });

  it("keeps searching the named workspace in place when {id} is accessible but not the active workspace", async () => {
    const router = renderSearchRouter(
      "/dashboard/workspace/ws-other/search?q=billing&scope=work-items#matches",
    );

    const searchView = await screen.findByTestId("scoped-workspace-search");
    expect(searchView).toHaveAttribute("data-workspace-id", "ws-other");
    expect(searchView).toHaveAttribute("data-q", "billing");
    expect(searchView).toHaveAttribute("data-scope", "work-items");
    expect(router.history.location.href).toBe(
      "/dashboard/workspace/ws-other/search?q=billing&scope=work-items#matches",
    );

    fireEvent.click(screen.getByText("change-search"));
    await waitFor(() =>
      expect(router.state.location.search).toEqual({
        q: "updated",
        scope: "work-items",
      }),
    );
    expect(router.state.location.pathname).toBe(
      "/dashboard/workspace/ws-other/search",
    );
  });

  it("shows an explicit unavailable state and never redirects or searches when {id} is missing or inaccessible", async () => {
    const router = renderSearchRouter(
      "/dashboard/workspace/ws-forbidden/search?q=secret#top",
    );

    expect(
      await screen.findByTestId("workspace-search-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workspace:search.unavailableTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workspace:search.unavailableDescription"),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      "/dashboard/workspace/ws-forbidden/search",
    );
    expect(state.renderedWorkspaceSearch).not.toHaveBeenCalled();
  });

  it("shows loading while workspace membership is resolving", async () => {
    state.workspaces.isLoading = true;
    state.workspaces.data = undefined;
    const router = renderSearchRouter("/dashboard/workspace/ws-active/search");

    expect(
      await screen.findByTestId("workspace-search-loading"),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      "/dashboard/workspace/ws-active/search",
    );
    expect(state.renderedWorkspaceSearch).not.toHaveBeenCalled();
  });
});
