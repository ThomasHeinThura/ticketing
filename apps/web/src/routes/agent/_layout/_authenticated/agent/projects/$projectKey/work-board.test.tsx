import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

const state = vi.hoisted(() => ({
  search: { layout: "board", sort: "key", dir: "asc" } as Record<
    string,
    string
  >,
  navigate: vi.fn(),
  perms: {
    assign: false,
    transition: false,
    rank: false,
    update: true,
    checking: false,
  },
  listItems: [] as unknown[],
  boardPages: [] as unknown[],
  boardProps: undefined as Record<string, unknown> | undefined,
  panelProps: undefined as Record<string, unknown> | undefined,
  toolbarProps: undefined as Record<string, unknown> | undefined,
  listEnabled: undefined as boolean | undefined,
  boardEnabled: undefined as boolean | undefined,
  statesEnabled: undefined as boolean | undefined,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/work-item/work-item-create-trigger", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-create-dialog-shell", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-list-loading", () => ({
  default: () => <div data-testid="list-loading" />,
}));
vi.mock("@/components/work-item/work-item-list-realtime", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-items-panel", () => ({
  default: (props: Record<string, unknown>) => {
    state.panelProps = props;
    return <div data-testid="panel" />;
  },
}));
vi.mock("@/components/work-item/work-item-board", () => ({
  default: (props: Record<string, unknown>) => {
    state.boardProps = props;
    return <div data-testid="board" />;
  },
}));
vi.mock("@/components/work-item/bulk-assign-toolbar", () => ({
  default: (props: Record<string, unknown>) => {
    state.toolbarProps = props;
    return <div data-testid="toolbar" />;
  },
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "ws_1" }, isLoading: false, isError: false }),
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({
    data: [{ id: "proj_1", slug: "WLP", name: "Wallop", workspaceId: "ws_1" }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-items", () => ({
  default: (args: { enabled?: boolean }) => {
    state.listEnabled = args.enabled;
    return {
      data: {
        items: state.listItems,
        hasPartialFailure: false,
        hasMore: false,
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/queries/work-item/use-get-board-work-items", () => ({
  default: (args: { enabled?: boolean }) => {
    state.boardEnabled = args.enabled;
    return {
      data: { pages: state.boardPages },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/queries/project/use-get-project-states", () => ({
  default: (_id: string | undefined, enabled?: boolean) => {
    state.statesEnabled = enabled;
    return {
      data: [{ id: "s1", name: "Open" }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canAssignTasks: () => state.perms.assign,
    canTransitionTasks: () => state.perms.transition,
    canRankTasks: () => state.perms.rank,
    canUpdateTasks: () => state.perms.update,
    isCheckingPermissions: state.perms.checking,
  }),
}));

import { Route } from "./work";

const row = (key: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${key}`,
  key,
  stateId: "s1",
  unavailableFields: [],
  ...extra,
});

/** Calls a callback prop a mocked child captured, failing loudly if it was never rendered. */
function callProp(
  props: Record<string, unknown> | undefined,
  name: string,
  ...args: unknown[]
) {
  const fn = props?.[name];
  if (typeof fn !== "function") throw new Error(`prop ${name} not captured`);
  return fn(...args);
}

async function renderRoute() {
  const Component = Route.options.component as () => React.JSX.Element;
  const view = render(<Component />);
  // The layouts are lazy chunks: wait for whichever one this URL selects.
  await screen.findByTestId(state.search.layout === "list" ? "panel" : "board");
  return view;
}

beforeEach(() => {
  state.search = { layout: "board", sort: "key", dir: "asc" };
  state.perms = {
    assign: false,
    transition: false,
    rank: false,
    update: true,
    checking: false,
  };
  state.listItems = [row("WLP-1"), row("WLP-2")];
  state.boardPages = [{ items: [row("WLP-1"), row("WLP-2")] }];
  state.boardProps = undefined;
  state.panelProps = undefined;
  state.toolbarProps = undefined;
  state.navigate.mockReset();
  vi.spyOn(Route, "useParams").mockReturnValue({ projectKey: "WLP" } as never);
  vi.spyOn(Route, "useSearch").mockImplementation(
    (() => state.search) as never,
  );
  vi.spyOn(Route, "useNavigate").mockReturnValue(state.navigate as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("work route layouts", () => {
  it("board layout fetches the board and states and not the list", async () => {
    await renderRoute();
    expect(screen.getByTestId("board")).toBeInTheDocument();
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(state.boardEnabled).toBe(true);
    expect(state.statesEnabled).toBe(true);
    expect(state.listEnabled).toBe(false);
  });

  it("list layout fetches the list and not the board or states", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc" };
    await renderRoute();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(state.boardEnabled).toBe(false);
    expect(state.statesEnabled).toBe(false);
    expect(state.listEnabled).toBe(true);
  });

  it("the layout toggle reports its state and writes the layout to the URL", async () => {
    await renderRoute();
    expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const update = state.navigate.mock.calls[0]?.[0] as {
      search: (prev: Record<string, string>) => Record<string, string>;
    };
    expect(update.search(state.search)).toMatchObject({ layout: "list" });
  });
});

describe("strict capability wiring", () => {
  it("passes rank and transition from rankTasks/transitionTasks, never from updateTasks", async () => {
    state.perms = { ...state.perms, update: true };
    await renderRoute();
    expect(state.boardProps?.canRank).toBe(false);
    expect(state.boardProps?.canTransition).toBe(false);
    expect(state.boardProps?.canSelect).toBe(false);
  });

  it("enables each control only from its own flag", async () => {
    state.perms = { ...state.perms, rank: true };
    await renderRoute();
    expect(state.boardProps).toMatchObject({
      canRank: true,
      canTransition: false,
      canSelect: false,
    });
    cleanup();
    state.perms = { ...state.perms, rank: false, transition: true };
    await renderRoute();
    expect(state.boardProps).toMatchObject({
      canRank: false,
      canTransition: true,
      canSelect: false,
    });
    cleanup();
    state.perms = { ...state.perms, transition: false, assign: true };
    await renderRoute();
    expect(state.boardProps).toMatchObject({
      canRank: false,
      canTransition: false,
      canSelect: true,
    });
  });

  it("grants nothing while capabilities are still loading", async () => {
    state.perms = {
      assign: true,
      transition: true,
      rank: true,
      update: true,
      checking: true,
    };
    await renderRoute();
    expect(state.boardProps).toMatchObject({
      canRank: false,
      canTransition: false,
      canSelect: false,
    });
  });

  it("the list's selection controls follow assignTasks only", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc" };
    await renderRoute();
    expect(state.panelProps?.canBulkAssign).toBe(false);
    cleanup();
    state.perms = { ...state.perms, assign: true };
    await renderRoute();
    expect(state.panelProps?.canBulkAssign).toBe(true);
  });
});

describe("bulk selection", () => {
  it("shows the toolbar only with assign capability and a non-empty selection", async () => {
    state.perms = { ...state.perms, assign: true };
    await renderRoute();
    expect(screen.queryByTestId("toolbar")).toBeNull();
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-1", true);
    });
    expect(await screen.findByTestId("toolbar")).toBeInTheDocument();
    expect(state.toolbarProps).toMatchObject({
      projectId: "proj_1",
      workspaceId: "ws_1",
      selectedKeys: ["WLP-1"],
    });
  });

  it("never shows the toolbar without assign capability even if a key is selected", async () => {
    await renderRoute();
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-1", true);
    });
    expect(screen.queryByTestId("toolbar")).toBeNull();
  });

  it("drops a selected key that has left the loaded items and keeps the rest", async () => {
    state.perms = { ...state.perms, assign: true };
    const view = await renderRoute();
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-1", true);
      callProp(state.boardProps, "onSelectionChange", "WLP-2", true);
    });
    expect(state.toolbarProps?.selectedKeys).toEqual(["WLP-1", "WLP-2"]);
    state.boardPages = [{ items: [row("WLP-2")] }];
    const Component = Route.options.component as () => React.JSX.Element;
    act(() => view.rerender(<Component />));
    expect(state.toolbarProps?.selectedKeys).toEqual(["WLP-2"]);
  });

  it("clear and partial completion update the selection", async () => {
    state.perms = { ...state.perms, assign: true };
    await renderRoute();
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-1", true);
      callProp(state.boardProps, "onSelectionChange", "WLP-2", true);
    });
    act(() => callProp(state.toolbarProps, "onAssigned", ["WLP-1"]));
    expect(state.toolbarProps?.selectedKeys).toEqual(["WLP-2"]);
    act(() => callProp(state.toolbarProps, "onClear"));
    expect(screen.queryByTestId("toolbar")).toBeNull();
  });

  it("select-all in the list selects only rows with a valid key", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc" };
    state.perms = { ...state.perms, assign: true };
    state.listItems = [
      row("WLP-1"),
      row("WLP-2", { unavailableFields: ["key"] }),
    ];
    await renderRoute();
    act(() => callProp(state.panelProps, "onSelectAll", true));
    expect(state.toolbarProps?.selectedKeys).toEqual(["WLP-1"]);
  });
});
