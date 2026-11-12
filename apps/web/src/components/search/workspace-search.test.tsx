import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceSearch from "./workspace-search";

const mocks = vi.hoisted(() => ({
  search: vi.fn((_params: Record<string, unknown>) => ({
    data: undefined as unknown,
    isLoading: false,
    isFetching: false,
  })),
  navigate: vi.fn(),
  activateWorkspace: vi.fn((_workspaceId: string) =>
    Promise.resolve({ id: "w2" }),
  ),
  toastError: vi.fn(),
  activeOrganizationId: "w1" as string | null,
  workspaces: [{ id: "w1" }, { id: "w2" }] as Array<{ id: string }>,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));
vi.mock("@/hooks/queries/search/use-global-search", () => ({
  default: (params: Record<string, unknown>) => mocks.search(params),
}));
vi.mock("@/hooks/queries/workspace/use-get-workspaces", () => ({
  default: () => ({ data: mocks.workspaces }),
}));
vi.mock("@/lib/activate-workspace-for-navigation", () => ({
  activateWorkspaceForNavigation: (workspaceId: string) =>
    mocks.activateWorkspace(workspaceId),
}));
vi.mock("@/lib/toast", () => ({
  toast: {
    error: mocks.toastError,
  },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: mocks.activeOrganizationId
        ? { session: { activeOrganizationId: mocks.activeOrganizationId } }
        : { session: {} },
    }),
  },
}));

const results = [
  {
    id: "wi1",
    type: "work_item",
    key: "HELP-24",
    title: "Reset the router",
    description: "In progress",
    status: "In progress",
    priority: "urgent",
    projectName: "Help desk",
    projectSlug: "HELP",
  },
  { id: "p1", type: "project", title: "Help desk", projectSlug: "HELP" },
  { id: "legacy", type: "task", title: "Legacy row" },
];

beforeEach(() => {
  vi.useFakeTimers();
  mocks.activeOrganizationId = "w1";
  mocks.workspaces = [{ id: "w1" }, { id: "w2" }];
  mocks.activateWorkspace.mockImplementation(() =>
    Promise.resolve({ id: "w2" }),
  );
  mocks.toastError.mockReset();
  mocks.search.mockImplementation((params) => ({
    data: params.q ? { results, totalCount: 3 } : undefined,
    isLoading: false,
    isFetching: false,
  }));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("WorkspaceSearch (P1R1-1)", () => {
  it("searches the canonical API from the URL q and scope and groups the hits", () => {
    render(
      <WorkspaceSearch
        workspaceId="w1"
        search={{ q: "HELP-24", scope: "work-items" }}
        onSearchChange={vi.fn()}
      />,
    );
    expect(mocks.search).toHaveBeenLastCalledWith({
      q: "HELP-24",
      workspaceId: "w1",
      type: "work_items",
      limit: 20,
    });
    expect(
      screen.getByPlaceholderText("workspace:search.placeholder"),
    ).toHaveValue("HELP-24");
  });

  it("groups work items and projects and hides legacy task rows", () => {
    render(
      <WorkspaceSearch
        workspaceId="w1"
        search={{ q: "help" }}
        onSearchChange={vi.fn()}
      />,
    );
    expect(mocks.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "all" }),
    );
    expect(
      screen.getByRole("region", { name: "navigation:search.groups.workItem" }),
    ).toHaveTextContent("HELP-24Reset the routerHelp deskIn progress");
    expect(
      screen.getByRole("region", { name: "navigation:search.groups.project" }),
    ).toHaveTextContent("Help desk");
    expect(screen.queryByText("Legacy row")).toBeNull();
    expect(screen.getByText("workspace:search.resultsFound:2")).toBeTruthy();
    fireEvent.click(screen.getByText("Reset the router"));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/agent/work-items/HELP-24",
    });
  });

  it("opens /agent directly for the active workspace, shows a toast when activation is refused or rejects, and navigates after activation succeeds", async () => {
    vi.useRealTimers();
    const onSearchChange = vi.fn();
    mocks.search.mockImplementation(() => ({
      data: {
        results: [
          { id: "w1", type: "workspace", title: "Active Workspace" },
          { id: "w2", type: "workspace", title: "Ops Workspace" },
          { id: "w-denied", type: "workspace", title: "Denied Workspace" },
        ],
        totalCount: 3,
      },
      isLoading: false,
      isFetching: false,
    }));

    render(
      <WorkspaceSearch
        workspaceId="w2"
        search={{ q: "workspace" }}
        onSearchChange={onSearchChange}
      />,
    );

    fireEvent.click(screen.getByText("Active Workspace"));
    expect(mocks.activateWorkspace).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent" });
    mocks.navigate.mockClear();

    fireEvent.click(screen.getByText("Denied Workspace"));
    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        "navigation:workspaceSwitcher.switchFailed",
      );
    });
    expect(mocks.activateWorkspace).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onSearchChange).not.toHaveBeenCalled();
    expect(
      screen.getByPlaceholderText("workspace:search.placeholder"),
    ).toHaveValue("workspace");

    mocks.toastError.mockClear();
    mocks.activateWorkspace.mockRejectedValueOnce(new Error("403 Forbidden"));

    fireEvent.click(screen.getByText("Ops Workspace"));
    await waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith("w2");
      expect(mocks.toastError).toHaveBeenCalledWith(
        "navigation:workspaceSwitcher.switchFailed",
      );
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onSearchChange).not.toHaveBeenCalled();
    expect(
      screen.getByPlaceholderText("workspace:search.placeholder"),
    ).toHaveValue("workspace");

    mocks.activateWorkspace.mockClear();
    fireEvent.click(screen.getByText("Ops Workspace"));
    await waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith("w2");
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/agent" });
    });
    expect(mocks.activateWorkspace.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigate.mock.invocationCallOrder[0],
    );
  });

  it("P1R2-10: a work-item row shows Kaneo's priority icon, key chip, project and status", () => {
    render(
      <WorkspaceSearch
        workspaceId="w1"
        search={{ q: "help" }}
        onSearchChange={vi.fn()}
      />,
    );
    const row = screen.getByText("Reset the router").closest("button");
    if (!row) throw new Error("missing result row");
    expect(row.querySelector("svg")).not.toBeNull();
    expect(screen.getByText("HELP-24")).toHaveClass("font-mono");
    expect(row).toHaveTextContent("Help desk");
    expect(screen.getAllByText("In progress")[0]).toHaveClass("rounded");
  });

  it("writes the debounced query and scope back to the URL state", () => {
    const onSearchChange = vi.fn();
    render(
      <WorkspaceSearch
        workspaceId="w1"
        search={{ scope: "projects" }}
        onSearchChange={onSearchChange}
      />,
    );
    fireEvent.change(
      screen.getByPlaceholderText("workspace:search.placeholder"),
      { target: { value: "  router " } },
    );
    expect(onSearchChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(onSearchChange).toHaveBeenCalledWith({
      q: "router",
      scope: "projects",
    });
  });

  it("changing scope keeps q and drops scope for everything", () => {
    const onSearchChange = vi.fn();
    render(
      <WorkspaceSearch
        workspaceId="w1"
        search={{ q: "help", scope: "projects" }}
        onSearchChange={onSearchChange}
      />,
    );
    fireEvent.click(screen.getByText("workspace:search.scopeAll"));
    expect(onSearchChange).toHaveBeenCalledWith({ q: "help" });
    fireEvent.click(screen.getByText("workspace:search.scopeWorkItems"));
    expect(onSearchChange).toHaveBeenLastCalledWith({
      q: "help",
      scope: "work-items",
    });
  });

  it("shows the empty state when nothing matches", () => {
    mocks.search.mockImplementation(() => ({
      data: { results: [], totalCount: 0 },
      isLoading: false,
      isFetching: false,
    }));
    render(
      <WorkspaceSearch
        workspaceId="w1"
        search={{ q: "zzz" }}
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByText("workspace:search.noResultsTitle")).toBeTruthy();
  });
});

describe("WorkspaceSearch page heading", () => {
  it("gives the search page one h1 (axe page-has-heading-one)", () => {
    render(
      <WorkspaceSearch workspaceId="w1" search={{}} onSearchChange={vi.fn()} />,
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "workspace:search.pageTitle",
      }),
    ).toBeInTheDocument();
  });
});
