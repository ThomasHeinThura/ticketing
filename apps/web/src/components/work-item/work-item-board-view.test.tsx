import { cleanup, render, screen } from "@testing-library/react";
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
  return render(
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
    />,
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
