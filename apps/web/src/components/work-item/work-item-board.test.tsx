import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemTransitionBlockedError } from "@/lib/work-item-transition-reasons";
import { useUserPreferencesStore } from "@/store/user-preferences";
import { translate } from "@/test/en-translation";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemBoard from "./work-item-board";

const drag = vi.hoisted(() => ({
  callbacks: undefined as Record<string, unknown> | undefined,
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      drag.callbacks = props as unknown as Record<string, unknown>;
      return <actual.DndContext {...props} />;
    },
  };
});
const rankWorkItem = vi.hoisted(() => vi.fn());
const transitionWorkItem = vi.hoisted(() => vi.fn());
const getWorkItemTransitions = vi.hoisted(() => vi.fn());
// Lets one test make `rankNeighbours` find nothing to rank against, the stale-column case the
// board's own bounds checks otherwise make unreachable from the keyboard.
const noNeighbours = vi.hoisted(() => ({ active: false }));

vi.mock("@/lib/work-item-board", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/work-item-board")>();
  return {
    ...actual,
    rankNeighbours: (...args: Parameters<typeof actual.rankNeighbours>) =>
      noNeighbours.active ? undefined : actual.rankNeighbours(...args),
  };
});

vi.mock("@/fetchers/work-item/rank-work-item", () => ({
  default: (...args: unknown[]) => rankWorkItem(...args),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: (...args: unknown[]) => transitionWorkItem(...args),
}));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: (...args: unknown[]) => getWorkItemTransitions(...args),
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

const states = [
  { id: "s-open", name: "Open" },
  { id: "s-done", name: "Done" },
  { id: "s-empty", name: "Parked" },
];

function item(
  key: string,
  stateId: string,
  position: string,
  overrides: Partial<WorkItemRow> = {},
): WorkItemRow {
  return {
    id: `id-${key}`,
    projectId: "proj_1",
    key,
    number: Number(key.split("-")[1]),
    title: `Title ${key}`,
    stateId,
    stateName: stateId,
    priority: null,
    assigneeId: null,
    assigneeName: null,
    position,
    unavailableFields: [],
    ...overrides,
  } as WorkItemRow;
}

const baseItems = [
  item("WLP-1", "s-open", "1"),
  item("WLP-2", "s-open", "2"),
  item("WLP-3", "s-open", "3"),
  item("WLP-4", "s-done", "1"),
  item("WLP-5", "s-done", "2"),
];

type BoardProps = Partial<Parameters<typeof WorkItemBoard>[0]>;

function board(props: BoardProps = {}, client = new QueryClient()) {
  const element = (next: BoardProps = {}): ReactNode => (
    <QueryClientProvider client={client}>
      <WorkItemBoard
        projectId="proj_1"
        states={states}
        statesError={false}
        workItems={baseItems}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        hasMore={false}
        isLoadingMore={false}
        onLoadMore={vi.fn()}
        canSelect={false}
        canTransition={false}
        canRank={false}
        selectedKeys={[]}
        onSelectionChange={vi.fn()}
        {...props}
        {...next}
      />
    </QueryClientProvider>
  );
  const view = render(element());
  return {
    client,
    rerender: (next: BoardProps) => view.rerender(element(next)),
  };
}

function column(name: string) {
  return screen.getByRole("group", { name });
}

function keysIn(name: string) {
  return within(column(name))
    .getAllByTestId("work-item-board-card")
    .map((card) => card.getAttribute("data-work-item-key"));
}

function card(key: string) {
  const found = screen
    .getAllByTestId("work-item-board-card")
    .find((candidate) => candidate.getAttribute("data-work-item-key") === key);
  if (!found) throw new Error(`no card ${key}`);
  return found;
}

function stateId(name: string) {
  return states.find((state) => state.name === name)?.id ?? name;
}
function callDrag(name: string, event: unknown) {
  const callback = drag.callbacks?.[name];
  if (typeof callback !== "function") throw new Error(`missing ${name}`);
  return callback(event);
}
async function dragTo(key: string, target: string | null, keyboard = false) {
  const id = `id-${key}`;
  const over =
    target === null
      ? null
      : { id: target.startsWith("WLP-") ? `id-${target}` : target };
  act(() =>
    callDrag("onDragStart", {
      active: { id },
      activatorEvent: keyboard
        ? new KeyboardEvent("keydown", { code: "Space" })
        : new MouseEvent("mousedown"),
    }),
  );
  await act(async () => {
    await callDrag("onDragEnd", { active: { id }, over });
  });
}
beforeEach(() => {
  useUserPreferencesStore.getState().resetDisplayPreferences();
  rankWorkItem.mockReset();
  rankWorkItem.mockResolvedValue({});
  transitionWorkItem.mockReset();
  transitionWorkItem.mockResolvedValue({});
  getWorkItemTransitions.mockReset();
  getWorkItemTransitions.mockResolvedValue([]);
});

afterEach(cleanup);

describe("WorkItemBoard layout (VW-8)", () => {
  it("renders one column per state in state order, including an empty one", () => {
    board();
    const names = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(["Open", "Done", "Parked"]);
    expect(
      within(column("Parked")).getByText("No work items in this state."),
    ).toBeInTheDocument();
  });

  it("orders cards by position numerically within each column", () => {
    board({
      workItems: [
        item("WLP-1", "s-open", "10"),
        item("WLP-2", "s-open", "9"),
        item("WLP-3", "s-open", "9.5"),
      ],
    });
    expect(keysIn("Open")).toEqual(["WLP-2", "WLP-3", "WLP-1"]);
  });

  it("gives each column count a distinct accessible name", () => {
    board();
    expect(screen.getByLabelText("3 work items in Open")).toBeInTheDocument();
    expect(screen.getByLabelText("2 work items in Done")).toBeInTheDocument();
  });

  it("shows loading, error with retry, and no-states empty states", () => {
    const onRetry = vi.fn();
    const first = board({ isLoading: true });
    expect(screen.getByTestId("work-item-board-loading")).toBeInTheDocument();
    first.rerender({ isLoading: false, isError: true, onRetry });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
    first.rerender({ isLoading: false, isError: false, states: [] });
    expect(
      screen.getByText("This project has no states yet"),
    ).toBeInTheDocument();
  });
});

describe("G6 states of the board", () => {
  it("empty: every column says it is empty when no card exists", () => {
    board({ workItems: [] });
    expect(screen.getAllByTestId("work-item-board-column")).toHaveLength(3);
    expect(screen.getAllByText("No work items in this state.")).toHaveLength(3);
  });

  it("loading: shows a busy skeleton, no columns", () => {
    board({ isLoading: true, workItems: undefined });
    expect(screen.getByTestId("work-item-board-loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByTestId("work-item-board")).toBeNull();
  });

  it("error: shows the error with a working retry instead of the board", () => {
    const onRetry = vi.fn();
    board({ isError: true, onRetry });
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("work-item-board")).toBeNull();
  });

  it("marks its loaded, error and no-states views as primary content, never the skeleton", () => {
    const ready = () =>
      document.querySelector("[data-primary-content-ready='true']");
    const first = board({ isLoading: true, workItems: undefined });
    expect(ready()).toBeNull();
    first.rerender({ isLoading: false, isError: true });
    expect(ready()).not.toBeNull();
    first.rerender({ isLoading: false, isError: false, states: [] });
    expect(ready()).not.toBeNull();
    first.rerender({ isLoading: false, isError: false });
    expect(ready()).toBe(screen.getByTestId("work-item-board"));
  });

  it("partial: a card whose title or priority failed validation says Unavailable instead of rendering blank or wrong", () => {
    board({
      workItems: [
        item("WLP-1", "s-open", "1", {
          title: "",
          priority: null,
          unavailableFields: ["title", "priority"],
        }),
      ],
    });
    const partial = card("WLP-1");
    expect(within(partial).getAllByText("Unavailable")).toHaveLength(2);
    expect(within(partial).queryByText("No priority")).toBeNull();
  });
});

describe("Kaneo card-only capability composition", () => {
  it.each([
    { canRank: false, canTransition: false },
    { canRank: true, canTransition: false },
    { canRank: false, canTransition: true },
  ])("has no substitute move/state buttons for %j", (capability) => {
    board(capability);
    expect(screen.queryByRole("button", { name: /^Move up/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move down/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Change state/ })).toBeNull();
    expect(card("WLP-1")).not.toHaveAttribute("draggable", "true");
    const activator = card("WLP-1").querySelector("[data-task-id]");
    expect(activator).toHaveAttribute("role", "button");
    expect(activator).toHaveAttribute("tabindex", "0");
    expect(activator).not.toHaveAttribute("aria-disabled", "true");
  });
  it("registers the pinned mouse, touch and keyboard sensors", () => {
    board({ canRank: true });
    const sensors = drag.callbacks?.sensors as {
      sensor: { name: string };
      options: unknown;
    }[];
    expect(sensors.map((sensor) => sensor.sensor.name)).toEqual([
      "MouseSensor",
      "TouchSensor",
      "KeyboardSensor",
    ]);
    expect(sensors[0].options).toEqual({
      activationConstraint: { distance: 8 },
    });
    expect(sensors[1].options).toEqual({
      activationConstraint: { delay: 250, tolerance: 10 },
    });
  });
  it("never enables a missing-key card or unauthorized drag", async () => {
    board({
      canSelect: true,
      canRank: true,
      workItems: [item("WLP-9", "s-open", "1", { unavailableFields: ["key"] })],
    });
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Select WLP-9" }),
    ).toHaveAttribute("aria-disabled", "true");
    await dragTo("WLP-9", "s-done");
    expect(getWorkItemTransitions).not.toHaveBeenCalled();
    expect(rankWorkItem).not.toHaveBeenCalled();
    expect(transitionWorkItem).not.toHaveBeenCalled();
  });
});
describe("drag to rank and transition (VW-9, VW-10)", () => {
  it("dropping a card on a later card in the same column ranks it after that card's slot", async () => {
    board({ canRank: true });
    await dragTo("WLP-1", "WLP-3");
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        beforeId: "id-WLP-3",
      }),
    );
  });

  it("dropping a card on an earlier card ranks it before that card", async () => {
    board({ canRank: true });
    await dragTo("WLP-3", "WLP-1");
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-3",
        afterId: "id-WLP-1",
      }),
    );
  });

  it("does not rank on a same-column drop without rank capability", async () => {
    board({ canTransition: true });
    await dragTo("WLP-1", "WLP-3");
    await Promise.resolve();
    expect(rankWorkItem).not.toHaveBeenCalled();
  });

  it("dropping on another column transitions via the offered edge, then ranks next to the drop target", async () => {
    getWorkItemTransitions.mockResolvedValue([
      {
        transitionId: "t1",
        toStateId: "s-done",
        toStateTemplateId: "tpl-done",
        toStateName: "Done",
        available: true,
        blockedBy: [],
      },
    ]);
    board({ canTransition: true, canRank: true });
    await dragTo("WLP-1", "WLP-5");
    await waitFor(() =>
      expect(transitionWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        toStateTemplateId: "tpl-done",
      }),
    );
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        beforeId: "id-WLP-4",
        afterId: "id-WLP-5",
      }),
    );
    expect(
      await within(screen.getByTestId("work-item-board")).findByRole("status"),
    ).toHaveTextContent("WLP-1 moved to Done.");
  });

  it("dropping on a column's empty area appends after its last card", async () => {
    getWorkItemTransitions.mockResolvedValue([
      {
        transitionId: "t1",
        toStateId: "s-done",
        toStateTemplateId: "tpl-done",
        toStateName: "Done",
        available: true,
        blockedBy: [],
      },
    ]);
    board({ canTransition: true, canRank: true });
    await dragTo("WLP-1", stateId("Done"));
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        beforeId: "id-WLP-5",
      }),
    );
  });

  it("without transition capability a cross-column drop is refused locally and writes nothing", async () => {
    board({ canRank: true });
    await dragTo("WLP-1", "WLP-5");
    expect(
      await screen.findByText(
        "You don't have permission to change the state of work items.",
      ),
    ).toBeInTheDocument();
    expect(getWorkItemTransitions).not.toHaveBeenCalled();
    expect(transitionWorkItem).not.toHaveBeenCalled();
  });

  it("reports a blocked edge with its reason and never calls transition", async () => {
    getWorkItemTransitions.mockResolvedValue([
      {
        transitionId: "t1",
        toStateId: "s-done",
        toStateTemplateId: "tpl-done",
        toStateName: "Done",
        available: false,
        blockedBy: [{ kind: "note", reasonCode: "note.required" }],
      },
    ]);
    board({ canTransition: true });
    await dragTo("WLP-1", stateId("Done"));
    expect(
      await screen.findByTestId("work-item-board-error"),
    ).toHaveTextContent(
      "WLP-1 can't move there right now (a note is required). Open it to add what's missing.",
    );
    expect(transitionWorkItem).not.toHaveBeenCalled();
  });

  it("a 400 from a dragged transition uses the transition wording", async () => {
    getWorkItemTransitions.mockResolvedValue([
      {
        transitionId: "t1",
        toStateId: "s-done",
        toStateTemplateId: "tpl-done",
        toStateName: "Done",
        available: true,
        blockedBy: [],
      },
    ]);
    transitionWorkItem.mockRejectedValue(new HttpError(400, "x"));
    board({ canTransition: true });
    await dragTo("WLP-1", stateId("Done"));
    expect(
      await screen.findByTestId("work-item-board-error"),
    ).toHaveTextContent("The state change for WLP-1 was not valid.");
  });

  it("reports no edge to that state as unavailable", async () => {
    board({ canTransition: true });
    await dragTo("WLP-1", stateId("Done"));
    expect(
      await screen.findByTestId("work-item-board-error"),
    ).toHaveTextContent("WLP-1 can't move to that state right now.");
  });

  it("says the move stood but the position was not saved when only the rank step fails", async () => {
    getWorkItemTransitions.mockResolvedValue([
      {
        transitionId: "t1",
        toStateId: "s-done",
        toStateTemplateId: "tpl-done",
        toStateName: "Done",
        available: true,
        blockedBy: [],
      },
    ]);
    rankWorkItem.mockRejectedValue(new HttpError(409, "x"));
    board({ canTransition: true, canRank: true });
    await dragTo("WLP-1", "WLP-5");
    expect(
      await screen.findByTestId("work-item-board-error"),
    ).toHaveTextContent(
      "WLP-1 moved to Done, but its position there was not saved.",
    );
  });
});

describe("failure handling for rank (404, 409, 422, 400, 403)", () => {
  it.each([
    [404, "WLP-1 is no longer available to you. The board was refreshed."],
    [
      409,
      "WLP-1 changed in the meantime and can't be moved from there. The board was refreshed.",
    ],
    [
      422,
      "WLP-1 can't be moved right now because a rule blocks it. The board was refreshed.",
    ],
    [
      400,
      "The work items around WLP-1 changed, so its position wasn't saved. The board was refreshed.",
    ],
    [403, "You don't have permission to move WLP-1."],
    [500, "Couldn't move WLP-1. The board was refreshed."],
  ])(
    "HTTP %i shows its own message and refreshes the board",
    async (status, text) => {
      rankWorkItem.mockRejectedValue(new HttpError(status, "x"));
      const { client } = board({ canRank: true });
      const invalidate = vi.spyOn(client, "invalidateQueries");
      await dragTo("WLP-1", "WLP-2");
      const alert = await screen.findByTestId("work-item-board-error");
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveAttribute("role", "alert");
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["work-items", "proj_1"],
      });
    },
  );
});

describe("DnD lifecycle, keyboard and concurrency", () => {
  it("keyboard drag uses both neighbours, announces the persisted move and refreshes", async () => {
    const { client } = board({ canRank: true });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await dragTo("WLP-1", "WLP-2", true);
    expect(rankWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      beforeId: "id-WLP-2",
      afterId: "id-WLP-3",
    });
    expect(
      within(screen.getByTestId("work-item-board")).getByRole("status"),
    ).toHaveTextContent("WLP-1 moved to position 2 of 3 in Open.");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "proj_1"],
    });
  });
  it("never starts a write without capabilities or when cancelled/outside/same-item", async () => {
    const view = board();
    await dragTo("WLP-1", "s-done");
    view.rerender({ canRank: true });
    await dragTo("WLP-1", null);
    await dragTo("WLP-1", "WLP-1");
    act(() => {
      callDrag("onDragStart", {
        active: { id: "id-WLP-1" },
        activatorEvent: new MouseEvent("mousedown"),
      });
      callDrag("onDragCancel", {});
    });
    await act(async () => {
      await callDrag("onDragEnd", {
        active: { id: "id-WLP-1" },
        over: { id: "id-WLP-2" },
      });
    });
    expect(rankWorkItem).not.toHaveBeenCalled();
    expect(getWorkItemTransitions).not.toHaveBeenCalled();
  });
  it("accepts only one write in flight and allows a new drag after completion", async () => {
    let finish!: (value: unknown) => void;
    rankWorkItem.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    board({ canRank: true, canTransition: true });
    act(() =>
      callDrag("onDragStart", {
        active: { id: "id-WLP-1" },
        activatorEvent: new MouseEvent("mousedown"),
      }),
    );
    let pending: Promise<unknown>;
    act(() => {
      pending = callDrag("onDragEnd", {
        active: { id: "id-WLP-1" },
        over: { id: "id-WLP-2" },
      });
    });
    await dragTo("WLP-3", "s-done");
    expect(rankWorkItem).toHaveBeenCalledTimes(1);
    expect(getWorkItemTransitions).not.toHaveBeenCalled();
    await act(async () => {
      finish({});
      await pending;
    });
    await dragTo("WLP-3", "WLP-1");
    expect(rankWorkItem).toHaveBeenCalledTimes(2);
  });
  it("restores keyboard focus to the moved card after persisted rows change", async () => {
    const view = board({ canRank: true });
    await dragTo("WLP-1", "WLP-3", true);
    view.rerender({
      workItems: baseItems.map((entry) =>
        entry.key === "WLP-1" ? { ...entry, position: "4" } : entry,
      ),
    });
    expect(document.activeElement).toBe(
      card("WLP-1").querySelector("[data-task-id]"),
    );
  });
  it("a failed keyboard move does not steal focus on a later refresh", async () => {
    rankWorkItem.mockRejectedValue(new HttpError(409, "conflict"));
    const view = board({ canRank: true });
    await dragTo("WLP-1", "WLP-3", true);
    const other = card("WLP-2").querySelector<HTMLElement>("[data-task-id]");
    other?.focus();
    view.rerender({ workItems: [...baseItems] });
    expect(document.activeElement).toBe(other);
  });
  it("a no-neighbour rank is a no-op without a saved announcement", async () => {
    noNeighbours.active = true;
    try {
      board({ canRank: true });
      await dragTo("WLP-1", "WLP-2", true);
      expect(rankWorkItem).not.toHaveBeenCalled();
      expect(
        within(screen.getByTestId("work-item-board")).getByRole("status"),
      ).toBeEmptyDOMElement();
    } finally {
      noNeighbours.active = false;
    }
  });
  it("does not fabricate success or leave an unhandled error if refreshing fails", async () => {
    const { client } = board({ canRank: true });
    vi.spyOn(client, "invalidateQueries").mockRejectedValue(
      new Error("offline"),
    );
    await dragTo("WLP-1", "WLP-2");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("work-item-board")).getByRole("status"),
    ).toBeEmptyDOMElement();
  });
});
describe("selection", () => {
  it("renders selection checkboxes only when canSelect, one distinct name per card", () => {
    board({ canSelect: false });
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    cleanup();
    board({ canSelect: true });
    const names = screen
      .getAllByRole("checkbox", { name: /^Select WLP-/ })
      .map((box) => box.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Select WLP-1");
  });

  it("reports single and column-wide selection through onSelectionChange", () => {
    const onSelectionChange = vi.fn();
    board({ canSelect: true, onSelectionChange });
    fireEvent.click(screen.getByRole("checkbox", { name: "Select WLP-2" }));
    expect(onSelectionChange).toHaveBeenCalledWith("WLP-2", true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all work items in Done" }),
    );
    expect(onSelectionChange).toHaveBeenCalledWith("WLP-4", true);
    expect(onSelectionChange).toHaveBeenCalledWith("WLP-5", true);
  });

  it("reflects the selected keys as checked", () => {
    board({ canSelect: true, selectedKeys: ["WLP-1"] });
    expect(
      screen.getByRole("checkbox", { name: "Select WLP-1" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select WLP-2" }),
    ).not.toBeChecked();
  });
});

describe("paging", () => {
  it("offers Load more only when the server has another page", () => {
    const onLoadMore = vi.fn();
    const view = board({ onLoadMore });
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    view.rerender({ hasMore: true, onLoadMore });
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});

describe("canonical board sort and manual rank", () => {
  it("preserves server sort order per state as additional cursor pages arrive", () => {
    const first = board({
      sort: "priority",
      dir: "desc",
      workItems: [
        item("WLP-3", "s-open", "3", { priority: "urgent" }),
        item("WLP-2", "s-open", "2", { priority: "high" }),
      ],
    });
    expect(keysIn("Open")).toEqual(["WLP-3", "WLP-2"]);
    first.rerender({
      workItems: [
        item("WLP-3", "s-open", "3", { priority: "urgent" }),
        item("WLP-2", "s-open", "2", { priority: "high" }),
        item("WLP-1", "s-open", "1", { priority: null }),
      ],
    });
    expect(keysIn("Open")).toEqual(["WLP-3", "WLP-2", "WLP-1"]);
  });

  it("disables manual rank writes under an explicit sort", async () => {
    board({ sort: "title", dir: "asc", canRank: true, canTransition: true });
    expect(screen.queryByRole("button", { name: /Move WLP-1 up/ })).toBeNull();
    expect(document.querySelector("[data-rank-button]")).toBeNull();
    await dragTo("WLP-1", "WLP-3");
    expect(rankWorkItem).not.toHaveBeenCalled();
    expect(transitionWorkItem).not.toHaveBeenCalled();
  });

  it("keeps workflow transitions available under explicit sorts without hidden rank writes", async () => {
    getWorkItemTransitions.mockResolvedValue([
      {
        toStateId: "s-done",
        toStateTemplateId: "template-done",
        available: true,
      },
    ]);
    board({ sort: "dueDate", dir: "desc", canRank: true, canTransition: true });
    await dragTo("WLP-1", "WLP-5");
    await waitFor(() =>
      expect(transitionWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        toStateTemplateId: "template-done",
      }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId("work-item-board")).getByRole("status"),
      ).toHaveTextContent("Done"),
    );
    expect(rankWorkItem).not.toHaveBeenCalled();
  });

  it("orders descending fractional positions precisely with stable ID ties and no rank actions", () => {
    board({
      sort: "position",
      dir: "desc",
      canRank: true,
      workItems: [
        item("WLP-3", "s-open", "1.0000000001"),
        item("WLP-2", "s-open", "1.0000000002"),
        item("WLP-1", "s-open", "1.0000000002"),
      ],
    });
    expect(keysIn("Open")).toEqual(["WLP-1", "WLP-2", "WLP-3"]);
    expect(document.querySelector("[data-rank-button]")).toBeNull();
  });
});

it("opens canonical card and title through the sheet callback, preserving modified full-page links", () => {
  const onOpenItem = vi.fn();
  board({ onOpenItem });
  const title = within(card("WLP-1")).getByRole("link", {
    name: "WLP-1 Title WLP-1",
  });
  expect(fireEvent.click(title)).toBe(false);
  expect(onOpenItem).toHaveBeenLastCalledWith("WLP-1");
  fireEvent.click(within(card("WLP-2")).getByText("WLP-2"));
  expect(onOpenItem).toHaveBeenLastCalledWith("WLP-2");
  onOpenItem.mockClear();
  for (const modifiers of [
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
    { button: 1 },
  ]) {
    expect(fireEvent.click(title, modifiers)).toBe(true);
  }
  expect(onOpenItem).not.toHaveBeenCalled();
  expect(title).toHaveAttribute("href", "/agent/work-items/WLP-1");
});

it("starts and cancels an actual keyboard sensor drag with only the Kaneo card in its overlay", async () => {
  board({ canRank: true, canTransition: true });
  const activator = card("WLP-1").querySelector<HTMLElement>("[data-task-id]");
  if (!activator) throw new Error("missing canonical card activator");
  activator.focus();
  fireEvent.keyDown(activator, { key: " ", code: "Space" });
  const overlay = await screen.findByTestId("work-item-drag-overlay-card");
  expect(
    within(overlay).getByRole("link", { name: "WLP-1 Title WLP-1" }),
  ).toBeInTheDocument();
  expect(
    within(overlay).queryByRole("button", { name: /^Move|^Change state/ }),
  ).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
  await waitFor(() =>
    expect(
      screen.queryByTestId("work-item-drag-overlay-card"),
    ).not.toBeInTheDocument(),
  );
  expect(rankWorkItem).not.toHaveBeenCalled();
  expect(transitionWorkItem).not.toHaveBeenCalled();
});

it.each([
  [404, "is no longer available"],
  [403, "don't have permission"],
  [409, "changed in the meantime"],
  [422, "a rule blocks it"],
  [500, "Couldn't move"],
])(
  "surfaces transition HTTP %i and re-enables later gestures without faking a move",
  async (status, message) => {
    getWorkItemTransitions.mockResolvedValue([
      {
        toStateId: "s-done",
        toStateTemplateId: "tpl-done",
        available: true,
        blockedBy: [],
      },
    ]);
    transitionWorkItem.mockRejectedValueOnce(new HttpError(status, "blocked"));
    board({ canRank: true, canTransition: true });
    await dragTo("WLP-1", "s-done");
    expect(screen.getByTestId("work-item-board-error")).toHaveTextContent(
      message,
    );
    expect(keysIn("Open")).toContain("WLP-1");
    expect(rankWorkItem).not.toHaveBeenCalled();
    transitionWorkItem.mockResolvedValueOnce({});
    await dragTo("WLP-1", "s-done");
    expect(transitionWorkItem).toHaveBeenCalledTimes(2);
  },
);

it("retains the actual keyboard focus on a completed cross-column transition", async () => {
  getWorkItemTransitions.mockResolvedValue([
    {
      toStateId: "s-done",
      toStateTemplateId: "tpl-done",
      available: true,
      blockedBy: [],
    },
  ]);
  const view = board({ canTransition: true });
  await dragTo("WLP-1", "s-done", true);
  view.rerender({
    workItems: baseItems.map((entry) =>
      entry.key === "WLP-1" ? { ...entry, stateId: "s-done" } : entry,
    ),
  });
  expect(document.activeElement).toBe(
    card("WLP-1").querySelector("[data-task-id]"),
  );
});

it.each(["offer", "write"])(
  "translates bounded %s approval blocker codes and never spills unknown server values",
  async (source) => {
    const blockedBy = [
      { reasonCode: "cab.pending" },
      { reasonCode: "secret-account-or-other-unrecognized-detail" },
    ];
    getWorkItemTransitions.mockResolvedValue([
      {
        toStateId: "s-done",
        toStateTemplateId: "tpl-done",
        available: source === "write",
        blockedBy,
      },
    ]);
    if (source === "write")
      transitionWorkItem.mockRejectedValue(
        new WorkItemTransitionBlockedError(
          blockedBy.map((reason) => reason.reasonCode),
        ),
      );
    board({ canTransition: true });
    await dragTo("WLP-1", "s-done");
    const alert = screen.getByTestId("work-item-board-error");
    expect(alert).not.toHaveTextContent("cab.pending");
    expect(alert).not.toHaveTextContent("secret-account");
    expect(alert).toHaveTextContent(
      translate("workItems:journey.reasonCabPending"),
    );
    expect(alert).toHaveTextContent(
      translate("workItems:journey.reasonUnknown"),
    );
    expect(rankWorkItem).not.toHaveBeenCalled();
  },
);

describe("original card display preferences over persisted projections", () => {
  it("renders labels and genuine rich-text checklist counts, and immediately respects the original display toggles", () => {
    board({
      workItems: [
        item("WLP-1", "s-open", "1", {
          labels: [
            {
              id: "label-access",
              name: "Access",
              color: "var(--color-primary)",
            },
          ],
          description: {
            type: "doc",
            content: [
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    attrs: { checked: true },
                    content: [{ type: "paragraph" }],
                  },
                  {
                    type: "taskItem",
                    attrs: { checked: false },
                    content: [{ type: "paragraph" }],
                  },
                ],
              },
            ],
          },
        }),
      ],
    });
    expect(within(card("WLP-1")).getByText("Access")).toBeInTheDocument();
    expect(within(card("WLP-1")).getByText("1/2")).toBeInTheDocument();
    expect(within(card("WLP-1")).getByText("WLP-1")).toBeInTheDocument();
    act(() =>
      useUserPreferencesStore.setState({
        showLabels: false,
        showTaskItemCounts: false,
        showTaskNumbers: false,
      }),
    );
    expect(within(card("WLP-1")).queryByText("Access")).toBeNull();
    expect(within(card("WLP-1")).queryByText("1/2")).toBeNull();
    expect(within(card("WLP-1")).queryByText("WLP-1")).toBeNull();
    expect(within(card("WLP-1")).getByRole("link")).toHaveAttribute(
      "href",
      "/agent/work-items/WLP-1",
    );
  });
});
