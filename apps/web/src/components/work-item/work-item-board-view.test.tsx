import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import WorkItemBoardView from "./work-item-board-view";

const state = vi.hoisted(() => ({
  perms: {
    transition: false,
    rank: false,
    update: true,
    assign: false,
    setPriority: false,
    checking: false,
  },
  boardProps: undefined as Record<string, unknown> | undefined,
  groupedProps: undefined as Record<string, unknown> | undefined,
  pages: [] as unknown[],
  itemsLoading: false,
  queryProps: undefined as Record<string, unknown> | undefined,
  combinedPages: undefined as unknown[] | undefined,
  capabilityGet: vi.fn(),
}));

vi.mock("@/hooks/queries/agile/use-wip-limits", () => ({
  default: () => ({ limits: new Map<string, number>(), canManage: false }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/components/work-item/work-item-list-loading", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-list-realtime", () => ({
  default: () => <div data-testid="realtime" />,
}));
vi.mock("./work-item-board", () => ({
  default: (props: Record<string, unknown>) => {
    state.boardProps = props;
    return <div data-testid="board" />;
  },
}));
vi.mock("./work-item-grouped-board", () => ({
  default: (props: Record<string, unknown>) => {
    state.groupedProps = props;
    return <div data-testid="grouped-board" />;
  },
}));
vi.mock("@/hooks/queries/work-item/use-get-board-work-items", () => ({
  default: (props: Record<string, unknown>) => {
    state.queryProps = props;
    return {
      data: { pages: state.pages },
      isLoading: state.itemsLoading,
      isError: false,
      refetch: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/queries/work-item/use-get-combined-board-work-items", () => ({
  default: () => ({
    data: state.combinedPages ? { pages: state.combinedPages } : undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));
vi.mock("@taskdesk/libs", () => ({
  client: {
    capabilities: {
      $get: (...args: unknown[]) => state.capabilityGet(...args),
    },
  },
}));
vi.mock("@/hooks/queries/project/use-get-project-states", () => ({
  default: () => ({
    data: [{ id: "s1", name: "Open" }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canTransitionTasks: () => state.perms.transition,
    canRankTasks: () => state.perms.rank,
    canUpdateTasks: () => state.perms.update,
    canAssignTasks: () => state.perms.assign,
    canSetPriorityTasks: () => state.perms.setPriority,
    isCheckingPermissions: state.perms.checking,
  }),
}));

const row = (key: string) => ({ id: `id-${key}`, key, unavailableFields: [] });

function mount(props: Partial<Parameters<typeof WorkItemBoardView>[0]> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorkItemBoardView
        project={{ id: "proj_1" }}
        realtimeProjectId="proj_1"
        realtimeStatus={{ projectId: "proj_1", status: "available" }}
        onRealtimeAvailabilityChange={vi.fn()}
        canSelect={false}
        selectedKeys={[]}
        onSelectionChange={vi.fn()}
        onPruneSelection={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.perms = {
    transition: false,
    rank: false,
    update: true,
    assign: false,
    setPriority: false,
    checking: false,
  };
  state.boardProps = undefined;
  state.groupedProps = undefined;
  state.pages = [{ items: [row("WLP-1"), row("WLP-2")] }];
  state.combinedPages = undefined;
  state.capabilityGet.mockReset();
  state.itemsLoading = false;
});
afterEach(cleanup);

describe("WorkItemBoardView strict capability wiring", () => {
  it("never derives rank or transition from updateTasks", () => {
    mount();
    expect(state.boardProps).toMatchObject({
      canRank: false,
      canTransition: false,
      canSelect: false,
    });
  });

  it("enables each control only from its own flag", () => {
    state.perms.rank = true;
    mount();
    expect(state.boardProps).toMatchObject({
      canRank: true,
      canTransition: false,
    });
    cleanup();
    state.perms = { ...state.perms, rank: false, transition: true };
    mount();
    expect(state.boardProps).toMatchObject({
      canRank: false,
      canTransition: true,
    });
  });

  it("passes selection straight from canSelect", () => {
    mount({ canSelect: true });
    expect(state.boardProps?.canSelect).toBe(true);
  });

  it("grants nothing while capabilities are loading", () => {
    state.perms = {
      transition: true,
      rank: true,
      update: true,
      assign: true,
      setPriority: true,
      checking: true,
    };
    mount();
    expect(state.boardProps).toMatchObject({
      canRank: false,
      canTransition: false,
    });
  });
});

describe("WorkItemBoardView data", () => {
  it("reports the loaded keys so stale selections can be pruned", () => {
    const onPruneSelection = vi.fn();
    mount({ onPruneSelection });
    expect(onPruneSelection).toHaveBeenCalledWith(new Set(["WLP-1", "WLP-2"]));
  });

  it("shows the realtime fallback notice only when realtime is unavailable", () => {
    mount();
    expect(screen.queryByTestId("realtime-unavailable")).toBeNull();
    cleanup();
    mount({ realtimeStatus: { projectId: "proj_1", status: "unavailable" } });
    expect(screen.getByTestId("realtime-unavailable")).toBeInTheDocument();
  });

  it("mounts realtime only once loaded", async () => {
    state.itemsLoading = true;
    mount();
    expect(screen.queryByTestId("realtime")).toBeNull();
    cleanup();
    state.itemsLoading = false;
    mount();
    expect(await screen.findByTestId("realtime")).toBeInTheDocument();
  });
});

it("forwards an explicit sort consistently to the query and canonical board", () => {
  mount({ sort: "priority", dir: "desc" });
  expect(state.queryProps).toMatchObject({ sort: "priority", dir: "desc" });
  expect(state.boardProps).toMatchObject({ sort: "priority", dir: "desc" });
});
it("does not present filtered key pages as manually ranked cards", () => {
  mount({ filter: "priority = high", sort: "position", dir: "desc" });
  expect(state.queryProps).toMatchObject({ sort: "key", dir: "asc" });
  expect(state.boardProps).toMatchObject({ sort: "key", dir: "asc" });
});

describe("WorkItemBoardView grouping (VW-13)", () => {
  it("renders the state board by default and for the state grouping", () => {
    mount();
    expect(screen.getByTestId("board")).toBeInTheDocument();
    expect(screen.queryByTestId("grouped-board")).toBeNull();
    cleanup();
    mount({ group: "state" });
    expect(screen.getByTestId("board")).toBeInTheDocument();
  });

  it("renders the grouped board for assignee and priority, from the same rows", () => {
    mount({ group: "assignee" });
    expect(screen.queryByTestId("board")).toBeNull();
    expect(state.groupedProps).toMatchObject({
      projectId: "proj_1",
      field: "assignee",
    });
    expect(state.groupedProps?.workItems).toHaveLength(2);
    cleanup();
    mount({ group: "priority" });
    expect(state.groupedProps).toMatchObject({ field: "priority" });
    cleanup();
    mount({ group: "label" });
    expect(state.groupedProps).toMatchObject({ field: "label" });
    cleanup();
    mount({
      group: "cf.customer_impact",
      customField: {
        key: "customer_impact",
        name: "Customer impact",
        format: "select",
        options: [{ key: "high", label: "High" }],
      },
    });
    expect(state.queryProps).toMatchObject({
      columns: ["cf.customer_impact"],
    });
    expect(state.groupedProps).toMatchObject({
      field: "cf.customer_impact",
      customField: { key: "customer_impact", name: "Customer impact" },
    });
  });

  it("derives each grouped capability from its own flag and grants nothing while loading", () => {
    state.perms = {
      ...state.perms,
      update: true,
      assign: false,
      setPriority: true,
    };
    mount({ group: "priority" });
    expect(state.groupedProps).toMatchObject({
      canAssign: true,
      canUnassignAny: false,
      canUpdate: true,
      canSetPriority: true,
      peopleEnabled: true,
    });
    cleanup();
    state.perms = {
      ...state.perms,
      update: false,
      assign: false,
      setPriority: true,
    };
    mount({ group: "priority" });
    expect(state.groupedProps).toMatchObject({
      canAssign: false,
      canUpdate: false,
    });
    cleanup();
    state.perms = { ...state.perms, assign: true, checking: true };
    mount({ group: "assignee" });
    expect(state.groupedProps).toMatchObject({
      canAssign: false,
      canUnassignAny: false,
      canUpdate: false,
      canSetPriority: false,
      peopleEnabled: false,
    });
  });
});

describe("combined board capabilities", () => {
  it("uses each source project's cached capability query and fails closed on errors", async () => {
    state.combinedPages = [
      {
        columns: [
          {
            templateId: "todo-template",
            name: "Todo",
            group: "unstarted",
            position: 0,
          },
        ],
        items: [
          {
            ...row("HELP-1"),
            projectId: "child-project",
            stateId: "child-state",
            stateTemplateId: "todo-template",
            sourceProject: {
              id: "child-project",
              key: "CHILD",
              name: "Child project",
            },
          },
        ],
      },
    ];
    state.capabilityGet.mockResolvedValue({
      ok: true,
      json: async () => ({
        rankTasks: true,
        transitionTasks: false,
        updateTasks: true,
        assignTasks: false,
        setPriorityTasks: false,
        deleteTasks: false,
      }),
    });
    mount({ combined: true, workspaceId: "workspace" });

    await waitFor(() => {
      expect(state.boardProps?.canRank).toBe(true);
      expect(state.boardProps?.canTransition).toBe(false);
    });
    expect(state.capabilityGet).toHaveBeenCalledWith({
      query: { workspaceId: "workspace", projectId: "child-project" },
    });
    const capabilities = state.boardProps?.combinedCapabilities as Map<
      string,
      { canRank: boolean; canTransition: boolean; canBulkAct: boolean }
    >;
    expect(capabilities.get("child-project")).toEqual({
      canRank: true,
      canTransition: false,
      canBulkAct: true,
    });
    expect(state.boardProps?.combinedColumns).toMatchObject([
      { templateId: "todo-template", name: "Todo" },
    ]);

    cleanup();
    state.capabilityGet.mockResolvedValue({ ok: false });
    mount({ combined: true, workspaceId: "workspace" });
    await waitFor(() => expect(state.capabilityGet).toHaveBeenCalled());
    const failedCapabilities = state.boardProps?.combinedCapabilities as Map<
      string,
      { canRank: boolean; canTransition: boolean; canBulkAct: boolean }
    >;
    expect(failedCapabilities.get("child-project")).toEqual({
      canRank: false,
      canTransition: false,
      canBulkAct: false,
    });
  });
});
