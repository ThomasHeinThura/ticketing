import { Button, Fieldset, FieldsetLegend, Input } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQuery: () => ({ data: { data: [] }, isLoading: false, isError: false }),
}));

const state = vi.hoisted(() => ({
  search: { layout: "board", sort: "key", dir: "asc" } as Record<
    string,
    string
  >,
  navigate: vi.fn(),
  historySearch: {} as Record<string, string | undefined>,
  navigationResolvers: [] as Array<() => void>,
  navigationPromises: [] as Array<Promise<void>>,
  paneReadyKeys: [] as Array<string | undefined>,
  /** What the (mocked) selection toggle reports as the caller's assignTasks. */
  canAssign: false,
  listItems: [] as unknown[],
  paneProps: undefined as Record<string, unknown> | undefined,
  boardProps: undefined as Record<string, unknown> | undefined,
  panelProps: undefined as Record<string, unknown> | undefined,
  toolbarProps: undefined as Record<string, unknown> | undefined,
  listEnabled: undefined as boolean | undefined,
  /** The (mocked) server `layout.<projectId>` preference. */
  serverLayout: undefined as string | undefined,
  serverLayoutSettled: true,
  showCreateTrigger: false,
  loadCreateDialogShell: vi.fn(),
  preloadCreateDialogShell: vi.fn(),
  createDialogProps: undefined as Record<string, unknown> | undefined,
}));

const sidePaneModule = vi.hoisted(() => {
  let resolveModule: ((module: unknown) => void) | undefined;
  let moduleValue: unknown;
  const promise = new Promise<unknown>((resolve) => {
    resolveModule = resolve;
  });
  return {
    promise,
    delayNext: false,
    prepare: (value: unknown) => {
      moduleValue = value;
    },
    resolve: () => resolveModule?.(moduleValue),
  };
});

const sidePaneBodyModule = vi.hoisted(() => {
  let resolveModule: ((module: unknown) => void) | undefined;
  let moduleValue: unknown;
  const promise = new Promise<unknown>((resolve) => {
    resolveModule = resolve;
  });
  return {
    promise,
    delayNext: false,
    prepare: (value: unknown) => {
      moduleValue = value;
    },
    resolve: () => resolveModule?.(moduleValue),
  };
});

vi.mock("@/hooks/use-project-view-preference", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/use-project-view-preference")
  >()),
  useProjectViewPreference: ({ name }: { name: string }) =>
    name === "layout"
      ? {
          value: state.serverLayout,
          set: vi.fn(),
          settled: state.serverLayoutSettled,
        }
      : { value: undefined, set: vi.fn(), settled: true },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(
        typeof options?.count === "number"
          ? `${key}_${options.count === 1 ? "one" : "other"}`
          : key,
        options,
      ),
  }),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/work-item/work-item-create-trigger", async () => {
  const React = await import("react");
  return {
    default: ({
      onClick,
      pending,
    }: {
      onClick: () => void;
      pending: boolean;
    }) =>
      state.showCreateTrigger
        ? React.createElement(
            Button,
            { type: "button", onClick, disabled: pending },
            "Create work item",
          )
        : null,
  };
});
vi.mock("@/components/work-item/work-item-create-dialog-shell", () => ({
  default: () => null,
}));
vi.mock("@/components/work-item/work-item-create-dialog-shell-loader", () => ({
  loadWorkItemCreateDialogShell: () => state.loadCreateDialogShell(),
  preloadWorkItemCreateDialogShell: () => state.preloadCreateDialogShell(),
}));
vi.mock("@/lib/i18n/after-first-paint", () => ({
  afterFirstPaint: () => Promise.resolve(),
}));
vi.mock("@/components/work-item/work-item-list-loading", () => ({
  default: () => <div data-testid="list-loading" />,
}));
vi.mock("@/components/work-item/work-items-panel", () => ({
  default: (props: Record<string, unknown>) => {
    state.panelProps = props;
    const onOpenItem = props.onOpenItem as ((key: string) => void) | undefined;
    return (
      <>
        <div data-testid="panel" />
        {(["WLP-1", "WLP-2"] as const).map((key) => (
          <Fieldset
            key={key}
            data-testid={`route-opener-${key}`}
            data-task-id={`id-${key}`}
            tabIndex={0}
            onClick={(event) => {
              if (!event.ctrlKey && !event.metaKey) onOpenItem?.(key);
            }}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                event.key === "Enter"
              ) {
                onOpenItem?.(key);
              }
            }}
          >
            <FieldsetLegend>Task {key}</FieldsetLegend>
            <Input aria-label={`Child editor ${key}`} />
          </Fieldset>
        ))}
      </>
    );
  },
}));
vi.mock("@/components/work-item/work-item-list-controls", () => ({
  default: () => <div data-testid="filter-controls" />,
}));
vi.mock(
  "@/components/work-item/work-item-side-pane",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/components/work-item/work-item-side-pane")
      >();
    const { useCallback } = await import("react");
    const module = {
      default: (props: React.ComponentProps<typeof actual.default>) => {
        const onReady = props.onReady as ((key?: string) => void) | undefined;
        state.paneProps = props;
        const reportReady = useCallback(
          (key?: string) => {
            state.paneReadyKeys.push(key);
            onReady?.(key);
          },
          [onReady],
        );
        return (
          <>
            <div data-testid="sheet-frame" />
            <actual.default {...props} onReady={reportReady} />
          </>
        );
      },
    };
    if (sidePaneModule.delayNext) {
      sidePaneModule.delayNext = false;
      sidePaneModule.prepare(module);
      return sidePaneModule.promise;
    }
    return module;
  },
);
vi.mock("@/components/work-item/work-item-side-pane-body", () => {
  const module = {
    default: ({ itemKey }: { itemKey: string }) => (
      <div data-testid="mock-side-pane-body">{itemKey}</div>
    ),
  };
  if (sidePaneBodyModule.delayNext) {
    sidePaneBodyModule.delayNext = false;
    sidePaneBodyModule.prepare(module);
    return sidePaneBodyModule.promise;
  }
  return module;
});
vi.mock("@/components/work-item/work-item-board-view", () => ({
  default: (props: Record<string, unknown>) => {
    state.boardProps = props;
    const onOpenItem = props.onOpenItem as ((key: string) => void) | undefined;
    return (
      <>
        <div data-testid="board" />
        {(["WLP-1", "WLP-2"] as const).map((key) => (
          <Fieldset
            key={key}
            data-testid={`route-opener-${key}`}
            data-task-id={`id-${key}`}
            tabIndex={0}
            onClick={(event) => {
              if (!event.ctrlKey && !event.metaKey) onOpenItem?.(key);
            }}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                event.key === "Enter"
              ) {
                onOpenItem?.(key);
              }
            }}
          >
            <FieldsetLegend>Task {key}</FieldsetLegend>
            <Input aria-label={`Child editor ${key}`} />
          </Fieldset>
        ))}
      </>
    );
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
      }, [onCapabilityChange, state.canAssign]);
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
  await screen.findByTestId(
    state.search.layout === "board" ? "board" : "panel",
  );
  return view;
}

async function enterSelectionMode() {
  fireEvent.click(await screen.findByRole("button", { name: "Select items" }));
}

function writeSearchToBrowser(search: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value !== undefined) params.set(key, value);
  }
  window.history.replaceState(
    {},
    "",
    `/agent/projects/WLP/work${params.size ? `?${params}` : ""}`,
  );
}

function resolvedSearch(search: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(search).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  state.search = { layout: "board", sort: "key", dir: "asc" };
  state.historySearch = { ...state.search };
  state.navigationResolvers = [];
  state.navigationPromises = [];
  state.paneReadyKeys = [];
  sidePaneModule.delayNext = false;
  sidePaneBodyModule.delayNext = false;
  state.canAssign = false;
  state.serverLayout = undefined;
  state.serverLayoutSettled = true;
  state.showCreateTrigger = false;
  state.loadCreateDialogShell.mockReset().mockResolvedValue({
    default: (props: Record<string, unknown>) => {
      state.createDialogProps = props;
      return <div data-testid="create-dialog-shell" />;
    },
  });
  state.preloadCreateDialogShell.mockReset();
  state.createDialogProps = undefined;
  state.listItems = [row("WLP-1"), row("WLP-2")];
  state.boardProps = undefined;
  state.paneProps = undefined;
  state.panelProps = undefined;
  state.toolbarProps = undefined;
  state.navigate.mockReset();
  window.history.replaceState({}, "", "/agent/projects/WLP/work");
  vi.spyOn(Route, "useParams").mockReturnValue({ projectKey: "WLP" } as never);
  vi.spyOn(Route, "useSearch").mockImplementation(
    (() => state.search) as never,
  );
  vi.spyOn(Route, "useNavigate").mockReturnValue(state.navigate as never);
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/agent/projects/WLP/work");
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

  it("table layout renders the panel and fetches the list", async () => {
    state.search = { layout: "table", sort: "key", dir: "asc" };
    await renderRoute();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    expect(screen.queryByTestId("board")).toBeNull();
    expect(state.listEnabled).toBe(true);
  });

  it("the layout toggle reports its state, persists the per-project preference (VW-2), and writes the layout to the URL", async () => {
    await renderRoute();
    expect(screen.getByRole("button", { name: "Board" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Table" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Table" }));
    const update = state.navigate.mock.calls[0]?.[0] as {
      search: (prev: Record<string, string>) => Record<string, string>;
    };
    expect(update.search(state.search)).toMatchObject({ layout: "table" });
    expect(window.localStorage.getItem("taskdesk.layout.proj_1")).toBe("table");
  });
});

describe("create dialog boundary (G11)", () => {
  it("preloads after first paint and loads on the first create activation", async () => {
    state.search = { layout: "list", sort: "key", dir: "asc" };
    state.showCreateTrigger = true;
    await renderRoute();

    await waitFor(() =>
      expect(state.preloadCreateDialogShell).toHaveBeenCalledOnce(),
    );
    const trigger = screen.getByRole("button", { name: "Create work item" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    // Native button activation dispatches a click for Enter; detail=0 models that click.
    fireEvent.click(trigger, { detail: 0 });

    await screen.findByTestId("create-dialog-shell");
    expect(state.loadCreateDialogShell).toHaveBeenCalledOnce();
    expect(state.createDialogProps).toMatchObject({
      projectId: "proj_1",
      workspaceId: "ws_1",
    });
    expect(trigger).toHaveFocus();
  });
});

describe("layout restore (VW-2)", () => {
  const lastNavigation = () =>
    (
      state.navigate.mock.calls.at(-1)?.[0] as
        | { search: (prev: Record<string, string>) => Record<string, string> }
        | undefined
    )?.search(state.search);

  it("restores the server layout preference when the URL names no layout", async () => {
    state.serverLayout = "list";
    window.localStorage.setItem("taskdesk.layout.proj_1", "table");
    await renderRoute();
    await waitFor(() =>
      expect(lastNavigation()).toMatchObject({ layout: "list" }),
    );
    // The server's choice is also remembered by this browser for offline fallback.
    expect(window.localStorage.getItem("taskdesk.layout.proj_1")).toBe("list");
  });

  it("falls back to this browser's memory when the server holds none", async () => {
    window.localStorage.setItem("taskdesk.layout.proj_1", "table");
    await renderRoute();
    await waitFor(() =>
      expect(lastNavigation()).toMatchObject({ layout: "table" }),
    );
  });

  it("waits for the server answer instead of flashing the local layout first", async () => {
    state.serverLayoutSettled = false;
    window.localStorage.setItem("taskdesk.layout.proj_1", "table");
    await renderRoute();
    expect(state.navigate).not.toHaveBeenCalled();
  });
});

describe("pending work item sheet navigation", () => {
  it("cancels first and loaded opens from the invoking card before stale navigation can reopen them", async () => {
    state.search = {
      layout: "board",
      sort: "key",
      dir: "asc",
      filter: "state = open",
    };
    state.historySearch = { ...state.search };
    sidePaneModule.delayNext = true;
    state.navigate.mockImplementation(
      (options: {
        search: (
          previous: Record<string, string | undefined>,
        ) => Record<string, string | undefined>;
      }) => {
        state.historySearch = options.search(state.historySearch);
        writeSearchToBrowser(state.historySearch);
        let resolve: () => void = () => undefined;
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        state.navigationResolvers.push(resolve);
        state.navigationPromises.push(promise);
        return promise;
      },
    );

    const view = await renderRoute();
    const Component = Route.options.component as () => React.JSX.Element;
    const firstOpener = screen.getByTestId("route-opener-WLP-1");
    firstOpener.focus();
    fireEvent.keyDown(firstOpener, { key: "Enter", code: "Enter" });
    expect(new URLSearchParams(window.location.search).get("item")).toBe(
      "WLP-1",
    );
    expect(state.search.item).toBeUndefined();

    // The first Escape lands after history changed but before useSearch commits.
    fireEvent.keyDown(firstOpener, { key: "Escape", code: "Escape" });
    expect(state.navigate).toHaveBeenCalledTimes(2);
    expect(new URLSearchParams(window.location.search).has("item")).toBe(false);
    expect(state.search.item).toBeUndefined();
    await act(async () => {
      state.navigationResolvers[0]?.();
      await state.navigationPromises[0];
    });

    // Commit a second open to start the cold Sheet import, then Escape before it resolves.
    firstOpener.focus();
    fireEvent.keyDown(firstOpener, { key: "Enter", code: "Enter" });
    expect(new URLSearchParams(window.location.search).get("item")).toBe(
      "WLP-1",
    );
    state.search = resolvedSearch(state.historySearch);
    act(() => view.rerender(<Component />));
    await waitFor(() => expect(sidePaneModule.delayNext).toBe(false));
    expect(state.paneProps).toBeUndefined();

    fireEvent.keyDown(firstOpener, { key: "Escape", code: "Escape" });
    expect(state.navigate).toHaveBeenCalledTimes(4);
    expect(new URLSearchParams(window.location.search).has("item")).toBe(false);
    expect(new URLSearchParams(window.location.search).get("filter")).toBe(
      "state = open",
    );
    expect(state.search.item).toBe("WLP-1");

    // Commit the cancel while the opening navigation is still unresolved.
    state.search = resolvedSearch(state.historySearch);
    act(() => view.rerender(<Component />));
    await act(async () => {
      state.navigationResolvers[2]?.();
      state.navigationResolvers[3]?.();
      await Promise.all([
        state.navigationPromises[2],
        state.navigationPromises[3],
      ]);
    });
    await act(async () => {
      sidePaneModule.resolve();
      await Promise.resolve();
    });
    await screen.findByTestId("sheet-frame");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // The module is now loaded, but a second open is still pending until useSearch commits.
    const loadedOpener = screen.getByTestId("route-opener-WLP-2");
    loadedOpener.focus();
    fireEvent.keyDown(loadedOpener, { key: "Enter", code: "Enter" });
    expect(new URLSearchParams(window.location.search).get("item")).toBe(
      "WLP-2",
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "Child editor WLP-2" }),
      { key: "Escape", code: "Escape" },
    );
    expect(state.navigate).toHaveBeenCalledTimes(5);
    fireEvent.keyDown(loadedOpener, { key: "Escape", code: "Escape" });
    expect(state.navigate).toHaveBeenCalledTimes(6);
    expect(new URLSearchParams(window.location.search).has("item")).toBe(false);

    // Resolving the canceled open later must not bring the sheet back.
    state.search = resolvedSearch(state.historySearch);
    act(() => view.rerender(<Component />));
    await act(async () => {
      state.navigationResolvers[4]?.();
      state.navigationResolvers[5]?.();
      await Promise.all([
        state.navigationPromises[4],
        state.navigationPromises[5],
      ]);
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Once the loaded Sheet reports readiness, Escape is delegated to its own handler.
    loadedOpener.focus();
    fireEvent.keyDown(loadedOpener, { key: "Enter", code: "Enter" });
    sidePaneBodyModule.delayNext = true;
    state.search = resolvedSearch(state.historySearch);
    act(() => view.rerender(<Component />));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(state.paneReadyKeys.at(-1)).toBe("WLP-2"));
    expect(await screen.findByTestId("work-item-detail-loading")).toBeVisible();
    expect(sidePaneBodyModule.delayNext).toBe(false);
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    expect(state.navigate).toHaveBeenCalledTimes(8);
    expect(new URLSearchParams(window.location.search).has("item")).toBe(false);
    state.search = resolvedSearch(state.historySearch);
    act(() => view.rerender(<Component />));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await act(async () => {
      sidePaneBodyModule.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => {
      for (const resolve of state.navigationResolvers) resolve();
      await Promise.all(state.navigationPromises);
    });
  });

  it("leaves modified clicks, handled Escape, and active drag Escape alone", async () => {
    state.historySearch = { ...state.search };
    state.navigate.mockImplementation(
      (options: {
        search: (
          previous: Record<string, string | undefined>,
        ) => Record<string, string | undefined>;
      }) => {
        state.historySearch = options.search(state.historySearch);
        writeSearchToBrowser(state.historySearch);
        let resolve: () => void = () => undefined;
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        state.navigationResolvers.push(resolve);
        state.navigationPromises.push(promise);
        return promise;
      },
    );

    await renderRoute();
    const opener = screen.getByTestId("route-opener-WLP-1");
    opener.focus();
    fireEvent.click(opener, { ctrlKey: true });
    expect(state.navigate).not.toHaveBeenCalled();

    fireEvent.keyDown(opener, { key: "Enter", code: "Enter" });
    expect(state.navigate).toHaveBeenCalledOnce();

    const handledEscape = new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    });
    handledEscape.preventDefault();
    opener.dispatchEvent(handledEscape);
    expect(state.navigate).toHaveBeenCalledOnce();

    fireEvent.keyDown(opener, {
      key: "Escape",
      code: "Escape",
      isComposing: true,
    });
    expect(state.navigate).toHaveBeenCalledOnce();

    opener.setAttribute("data-task-dragging", "true");
    fireEvent.keyDown(opener, { key: "Escape", code: "Escape" });
    expect(state.navigate).toHaveBeenCalledOnce();
    expect(new URLSearchParams(window.location.search).get("item")).toBe(
      "WLP-1",
    );
    await act(async () => {
      for (const resolve of state.navigationResolvers) resolve();
      await Promise.all(state.navigationPromises);
    });
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

  it("losing the assign capability while in selection mode turns the controls off", async () => {
    state.canAssign = true;
    const view = await renderRoute();
    await enterSelectionMode();
    expect(state.boardProps?.canSelect).toBe(true);
    state.canAssign = false;
    const Component = Route.options.component as () => React.JSX.Element;
    act(() => view.rerender(<Component />));
    expect(state.boardProps?.canSelect).toBe(false);
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

describe("selection announcements (accessibility.md)", () => {
  const announcement = () =>
    screen
      .getAllByRole("status")
      .map((node) => node.textContent)
      .join("|");

  it("announces nothing until selection mode is used", async () => {
    state.canAssign = true;
    await renderRoute();
    expect(announcement()).not.toMatch(/Selection mode|selected/);
  });

  it("announces entering and leaving selection mode and each change of the count", async () => {
    state.canAssign = true;
    await renderRoute();
    await enterSelectionMode();
    expect(announcement()).toContain(translate("workItems:bulk.modeOn"));
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-1", true);
    });
    expect(announcement()).toContain(
      translate("workItems:bulk.selected_one", { count: 1 }),
    );
    act(() => {
      callProp(state.boardProps, "onSelectionChange", "WLP-2", true);
    });
    expect(announcement()).toContain(
      translate("workItems:bulk.selected_other", { count: 2 }),
    );
    await enterSelectionMode();
    expect(announcement()).toContain("Selection mode off. Selection cleared.");
  });

  it("uses the one polite region, not a second one", async () => {
    state.canAssign = true;
    await renderRoute();
    await enterSelectionMode();
    expect(
      document.querySelectorAll('[role="status"][aria-live="polite"]'),
    ).toHaveLength(1);
  });
});

describe("canonical schedule selection compatibility", () => {
  it("retains a permanent selected key through the work route validator", () => {
    const validate = Route.options.validateSearch as (
      raw: unknown,
    ) => Record<string, unknown>;
    expect(validate({ layout: "board", taskId: "WLP-1" })).toMatchObject({
      layout: "board",
      item: "WLP-1",
    });
    expect(
      validate({ taskId: "f3d637ba-77bf-43e2-bd63-356da999a531" }),
    ).not.toHaveProperty("item");
  });
});

describe("selection toggle placement (no layout shift when it arrives)", () => {
  it("is the first control in the header actions, ahead of the layout buttons", async () => {
    state.canAssign = true;
    await renderRoute();
    const toggle = screen.getByRole("button", { name: "Select items" });
    const list = screen.getByRole("button", { name: "List" });
    expect(
      toggle.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

describe("canonical task sheet route ownership", () => {
  it.each(["board", "list", "table"])(
    "opens %s items without losing view state or scroll",
    async (layout) => {
      state.search = {
        layout,
        sort: "key",
        dir: "desc",
        filter: "state = open",
        item: "WLP-1",
      };
      const view = await renderRoute();
      const props = layout === "board" ? state.boardProps : state.panelProps;
      callProp(props, "onOpenItem", "WLP-2");
      const navigation = state.navigate.mock.calls.at(-1)?.[0];
      expect(navigation).toMatchObject({ replace: true, resetScroll: false });
      expect(navigation.search(state.search)).toEqual({
        ...state.search,
        item: "WLP-2",
      });
      expect(navigation.href).toBeUndefined();
      await screen.findByTestId("sheet-frame");
      callProp(state.paneProps, "onClose");
      const closing = state.navigate.mock.calls.at(-1)?.[0];
      expect(closing).toMatchObject({ replace: true, resetScroll: false });
      state.search = closing.search(state.search);
      const Component = Route.options.component as () => React.JSX.Element;
      act(() => view.rerender(<Component />));
      expect(screen.getByTestId("sheet-frame")).toBeInTheDocument();
      expect(state.paneProps?.itemKey).toBeUndefined();
      expect(state.search.filter).toBe("state = open");
    },
  );
});

describe("work route board grouping (VW-13, VW-1)", () => {
  it("passes the URL's grouping to the board view and defaults to state", async () => {
    await renderRoute();
    expect(state.boardProps?.group).toBe("state");
    cleanup();
    state.search = {
      layout: "board",
      sort: "key",
      dir: "asc",
      group: "assignee",
    };
    await renderRoute();
    expect(state.boardProps?.group).toBe("assignee");
  });

  it("offers the group menu on the board only", async () => {
    await renderRoute();
    expect(screen.getByRole("button", { name: "Group" })).toBeInTheDocument();
    cleanup();
    state.search = { layout: "list", sort: "key", dir: "asc" };
    await renderRoute();
    expect(screen.queryByRole("button", { name: "Group" })).toBeNull();
  });

  it("writes the chosen grouping to the URL, keeping the rest, and drops the default", async () => {
    state.search = {
      layout: "board",
      sort: "key",
      dir: "asc",
      filter: "priority = high",
    };
    await renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "Group" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Priority" }));
    const call = state.navigate.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace?: boolean;
    };
    expect(call.replace).toBe(true);
    expect(call.search(state.search)).toMatchObject({
      layout: "board",
      filter: "priority = high",
      group: "priority",
    });
    const stateCall = call.search({ ...state.search, group: "priority" });
    expect(stateCall.group).toBe("priority");
  });

  it("keeps the grouping when the layout is switched", async () => {
    state.search = {
      layout: "board",
      sort: "key",
      dir: "asc",
      group: "assignee",
    };
    await renderRoute();
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    const call = state.navigate.mock.calls.at(-1)?.[0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search(state.search)).toMatchObject({
      layout: "list",
      group: "assignee",
    });
  });
});
