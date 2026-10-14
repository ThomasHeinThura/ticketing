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
  /** What the (mocked) selection toggle reports as the caller's assignTasks. */
  canAssign: false,
  listItems: [] as unknown[],
  boardProps: undefined as Record<string, unknown> | undefined,
  panelProps: undefined as Record<string, unknown> | undefined,
  toolbarProps: undefined as Record<string, unknown> | undefined,
  listEnabled: undefined as boolean | undefined,
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
vi.mock("@/components/work-item/work-items-panel", () => ({
  default: (props: Record<string, unknown>) => {
    state.panelProps = props;
    return <div data-testid="panel" />;
  },
}));
vi.mock("@/components/work-item/work-item-board-view", () => ({
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
vi.mock("@/components/work-item/work-item-selection-toggle", async () => {
  const { useEffect } = await import("react");
  return {
    default: ({
      selectionMode,
      onToggle,
      onCapabilityChange,
    }: {
      selectionMode: boolean;
      onToggle: () => void;
      onCapabilityChange: (can: boolean) => void;
    }) => {
      useEffect(() => {
        onCapabilityChange(state.canAssign);
      }, [onCapabilityChange]);
      return state.canAssign ? (
        // ui-exempt: test double for the lazy selection toggle
        <button type="button" aria-pressed={selectionMode} onClick={onToggle}>
          Select items
        </button>
      ) : null;
    },
  };
});
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

async function enterSelectionMode() {
  fireEvent.click(await screen.findByRole("button", { name: "Select items" }));
}

beforeEach(() => {
  state.search = { layout: "board", sort: "key", dir: "asc" };
  state.canAssign = false;
  state.listItems = [row("WLP-1"), row("WLP-2")];
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
  it("board layout renders the board view and does not fetch the list", async () => {
    await renderRoute();
    expect(screen.getByTestId("board")).toBeInTheDocument();
    expect(screen.queryByTestId("panel")).toBeNull();
    expect(state.listEnabled).toBe(false);
    expect(state.boardProps?.project).toMatchObject({ id: "proj_1" });
  });

  it("list layout renders the panel and fetches the list", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc" };
    await renderRoute();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(screen.queryByTestId("board")).toBeNull();
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

describe("selection mode (G11: no per-row controls until asked)", () => {
  it("offers the Select items toggle only with assign capability", async () => {
    await renderRoute();
    expect(screen.queryByRole("button", { name: "Select items" })).toBeNull();
    cleanup();
    state.canAssign = true;
    await renderRoute();
    expect(
      screen.getByRole("button", { name: "Select items" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("per-row controls appear only after the capability and selection mode are both on (board)", async () => {
    state.canAssign = true;
    await renderRoute();
    expect(state.boardProps?.canSelect).toBe(false);
    await enterSelectionMode();
    expect(state.boardProps?.canSelect).toBe(true);
  });

  it("per-row controls appear only after the capability and selection mode are both on (list)", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc" };
    state.canAssign = true;
    await renderRoute();
    expect(state.panelProps?.canBulkAssign).toBe(false);
    await enterSelectionMode();
    expect(state.panelProps?.canBulkAssign).toBe(true);
  });

  it("selection mode alone, without the capability, never enables controls", async () => {
    await renderRoute();
    expect(state.boardProps?.canSelect).toBe(false);
    expect(state.panelProps).toBeUndefined();
  });

  it("leaving selection mode removes the controls and clears the selection", async () => {
    state.canAssign = true;
    await renderRoute();
    await enterSelectionMode();
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-1", true);
    });
    expect(await screen.findByTestId("toolbar")).toBeInTheDocument();
    await enterSelectionMode();
    expect(screen.queryByTestId("toolbar")).toBeNull();
    expect(state.boardProps?.canSelect).toBe(false);
    await enterSelectionMode();
    expect(state.boardProps?.selectedKeys).toEqual([]);
  });
});

describe("bulk selection", () => {
  it("shows the toolbar only with a non-empty selection in selection mode", async () => {
    state.canAssign = true;
    await renderRoute();
    await enterSelectionMode();
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

  it("the board view's prune callback drops keys that left the loaded set and keeps the rest", async () => {
    state.canAssign = true;
    await renderRoute();
    await enterSelectionMode();
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-1", true);
      callProp(state.boardProps, "onSelectionChange", "WLP-2", true);
    });
    expect(
      (await screen.findByTestId("toolbar")) &&
        state.toolbarProps?.selectedKeys,
    ).toEqual(["WLP-1", "WLP-2"]);
    act(() => {
      callProp(state.boardProps, "onPruneSelection", new Set(["WLP-2"]));
    });
    expect(state.toolbarProps?.selectedKeys).toEqual(["WLP-2"]);
  });

  it("clear and partial completion update the selection", async () => {
    state.canAssign = true;
    await renderRoute();
    await enterSelectionMode();
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-1", true);
      callProp(state.boardProps, "onSelectionChange", "WLP-2", true);
    });
    await screen.findByTestId("toolbar");
    act(() => callProp(state.toolbarProps, "onAssigned", ["WLP-1"]));
    expect(state.toolbarProps?.selectedKeys).toEqual(["WLP-2"]);
    act(() => callProp(state.toolbarProps, "onClear"));
    expect(screen.queryByTestId("toolbar")).toBeNull();
  });

  it("select-all in the list selects only rows with a valid key", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc" };
    state.canAssign = true;
    state.listItems = [
      row("WLP-1"),
      row("WLP-2", { unavailableFields: ["key"] }),
    ];
    await renderRoute();
    await enterSelectionMode();
    act(() => callProp(state.panelProps, "onSelectAll", true));
    await screen.findByTestId("toolbar");
    expect(state.toolbarProps?.selectedKeys).toEqual(["WLP-1"]);
  });

  it("drops list selections whose rows left the loaded list", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc" };
    state.canAssign = true;
    const view = await renderRoute();
    await enterSelectionMode();
    act(() => {
      callProp(state.panelProps, "onSelectionChange", "WLP-1", true);
      callProp(state.panelProps, "onSelectionChange", "WLP-2", true);
    });
    await screen.findByTestId("toolbar");
    state.listItems = [row("WLP-2")];
    const Component = Route.options.component as () => React.JSX.Element;
    act(() => view.rerender(<Component />));
    expect(state.toolbarProps?.selectedKeys).toEqual(["WLP-2"]);
  });
});
