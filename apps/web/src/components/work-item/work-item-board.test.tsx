import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
import { translate } from "@/test/en-translation";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemBoard from "./work-item-board";

const rankWorkItem = vi.hoisted(() => vi.fn());
const transitionWorkItem = vi.hoisted(() => vi.fn());
const getWorkItemTransitions = vi.hoisted(() => vi.fn());

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

/** Base UI selects an option on the real pointer sequence, not on a bare click. */
function pickOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

beforeEach(() => {
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

describe("capability gating (no UI-only security, but no controls without the flag)", () => {
  it("renders no rank, state or selection controls and no draggable cards with no capability", () => {
    board();
    expect(screen.queryByRole("button", { name: /^Move up/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move down/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Change state/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    for (const el of screen.getAllByTestId("work-item-board-card")) {
      expect(el).toHaveAttribute("draggable", "false");
    }
  });

  it("rank alone renders Move up/down but not Change state", () => {
    board({ canRank: true });
    expect(
      screen.getAllByRole("button", { name: /^Move up/ }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Change state/ })).toBeNull();
    expect(card("WLP-1")).toHaveAttribute("draggable", "true");
  });

  it("transition alone renders Change state but not Move up/down", () => {
    board({ canTransition: true });
    expect(
      screen.getAllByRole("button", { name: /^Change state/ }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Move up/ })).toBeNull();
  });

  it("selection checkboxes exist only when canSelect, with a distinct name per card", () => {
    board({ canSelect: true });
    expect(
      screen.getByRole("checkbox", { name: "Select WLP-1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Select all work items in Open" }),
    ).toBeInTheDocument();
  });

  it("an item with an unavailable key gets no link, controls or selection", () => {
    board({
      canSelect: true,
      canRank: true,
      canTransition: true,
      workItems: [item("WLP-9", "s-open", "1", { unavailableFields: ["key"] })],
    });
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByRole("checkbox", { name: "Select WLP-9" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("button", { name: /^Move up/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Change state/ })).toBeNull();
    expect(card("WLP-9")).toHaveAttribute("draggable", "false");
  });
});

describe("keyboard rank (VW-14 alternative to dragging)", () => {
  it("moves a card down by naming both new neighbours, announces it, and refreshes", async () => {
    const { client } = board({ canRank: true });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    fireEvent.click(
      screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
    );
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        beforeId: "id-WLP-2",
        afterId: "id-WLP-3",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "WLP-1 moved to position 2 of 3 in Open.",
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "proj_1"],
    });
  });

  it("moves a card up", async () => {
    board({ canRank: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Move up: WLP-3 in Open" }),
    );
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-3",
        beforeId: "id-WLP-1",
        afterId: "id-WLP-2",
      }),
    );
  });

  it("disables Move up on the first card and Move down on the last", () => {
    board({ canRank: true });
    expect(
      screen.getByRole("button", { name: "Move up: WLP-1 in Open" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move down: WLP-3 in Open" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
    ).toBeEnabled();
  });

  it("keeps focus on the same control after the board re-renders in the new order", async () => {
    const view = board({ canRank: true });
    const down = screen.getByRole("button", {
      name: "Move down: WLP-1 in Open",
    });
    down.focus();
    fireEvent.click(down);
    await waitFor(() => expect(rankWorkItem).toHaveBeenCalled());
    view.rerender({
      canRank: true,
      workItems: [
        item("WLP-2", "s-open", "1"),
        item("WLP-1", "s-open", "2"),
        item("WLP-3", "s-open", "3"),
        item("WLP-4", "s-done", "1"),
        item("WLP-5", "s-done", "2"),
      ],
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
      ).toHaveFocus(),
    );
  });

  it("falls back to the other direction when the moved card reaches the end", async () => {
    const view = board({ canRank: true });
    const down = screen.getByRole("button", {
      name: "Move down: WLP-2 in Open",
    });
    down.focus();
    fireEvent.click(down);
    await waitFor(() => expect(rankWorkItem).toHaveBeenCalled());
    view.rerender({
      canRank: true,
      workItems: [
        item("WLP-1", "s-open", "1"),
        item("WLP-3", "s-open", "2"),
        item("WLP-2", "s-open", "3"),
      ],
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move up: WLP-2 in Open" }),
      ).toHaveFocus(),
    );
  });

  it("does not allow a second move while one is in flight", async () => {
    let finish: (value: unknown) => void = () => {};
    rankWorkItem.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    board({ canRank: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Move down: WLP-2 in Open" }),
      ).toBeDisabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move down: WLP-2 in Open" }),
    );
    expect(rankWorkItem).toHaveBeenCalledTimes(1);
    finish({});
  });
});

describe("one write at a time", () => {
  it("ignores a drop that arrives while a keyboard move is still in flight", async () => {
    let finish: (value: unknown) => void = () => {};
    rankWorkItem.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    board({ canRank: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
    );
    await waitFor(() => expect(rankWorkItem).toHaveBeenCalledTimes(1));
    fireEvent.dragStart(card("WLP-3"));
    fireEvent.drop(card("WLP-1"));
    await Promise.resolve();
    expect(rankWorkItem).toHaveBeenCalledTimes(1);
    finish({});
  });
});

describe("drag to rank and transition (VW-9, VW-10)", () => {
  it("dropping a card on a later card in the same column ranks it after that card's slot", async () => {
    board({ canRank: true });
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(card("WLP-3"));
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        beforeId: "id-WLP-3",
      }),
    );
  });

  it("dropping a card on an earlier card ranks it before that card", async () => {
    board({ canRank: true });
    fireEvent.dragStart(card("WLP-3"));
    fireEvent.drop(card("WLP-1"));
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-3",
        afterId: "id-WLP-1",
      }),
    );
  });

  it("does not rank on a same-column drop without rank capability", async () => {
    board({ canTransition: true });
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(card("WLP-3"));
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
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(card("WLP-5"));
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
    expect(await screen.findByRole("status")).toHaveTextContent(
      "WLP-1 moved to Done.",
    );
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
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(column("Done"));
    await waitFor(() =>
      expect(rankWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        beforeId: "id-WLP-5",
      }),
    );
  });

  it("without transition capability a cross-column drop is refused locally and writes nothing", async () => {
    board({ canRank: true });
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(card("WLP-5"));
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
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(column("Done"));
    expect(
      await screen.findByTestId("work-item-board-error"),
    ).toHaveTextContent("WLP-1 can't move there right now (note.required).");
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
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(column("Done"));
    expect(
      await screen.findByTestId("work-item-board-error"),
    ).toHaveTextContent("The state change for WLP-1 was not valid.");
  });

  it("reports no edge to that state as unavailable", async () => {
    board({ canTransition: true });
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(column("Done"));
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
    fireEvent.dragStart(card("WLP-1"));
    fireEvent.drop(card("WLP-5"));
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
      fireEvent.click(
        screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
      );
      const alert = await screen.findByTestId("work-item-board-error");
      expect(alert).toHaveTextContent(text);
      expect(alert).toHaveAttribute("role", "alert");
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["work-items", "proj_1"],
      });
    },
  );

  it("re-enables the controls after a failed move", async () => {
    rankWorkItem.mockRejectedValue(new HttpError(409, "x"));
    board({ canRank: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
    );
    await screen.findByTestId("work-item-board-error");
    expect(
      screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
    ).toBeEnabled();
  });
});

describe("Change state control", () => {
  const offers = [
    {
      transitionId: "t1",
      toStateId: "s-done",
      toStateTemplateId: "tpl-done",
      toStateName: "Done",
      available: true,
      blockedBy: [],
    },
    {
      transitionId: "t2",
      toStateId: "s-x",
      toStateTemplateId: "tpl-x",
      toStateName: "Hidden",
      available: false,
      blockedBy: [],
    },
  ];

  async function chooseDone() {
    fireEvent.click(
      screen.getByRole("button", { name: "Change state of WLP-1" }),
    );
    fireEvent.click(
      await screen.findByRole("combobox", { name: "New state for WLP-1" }),
    );
    pickOption(await screen.findByRole("option", { name: "Done" }));
  }

  it("offers only available edges and applies the chosen one", async () => {
    getWorkItemTransitions.mockResolvedValue(offers);
    board({ canTransition: true });
    fireEvent.click(
      screen.getByRole("button", { name: "Change state of WLP-1" }),
    );
    fireEvent.click(
      await screen.findByRole("combobox", { name: "New state for WLP-1" }),
    );
    const done = await screen.findByRole("option", { name: "Done" });
    expect(screen.queryByRole("option", { name: "Hidden" })).toBeNull();
    pickOption(done);
    fireEvent.click(
      screen.getByRole("button", { name: "Move WLP-1 to the chosen state" }),
    );
    await waitFor(() =>
      expect(transitionWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        toStateTemplateId: "tpl-done",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "WLP-1 moved to Done.",
    );
  });

  it("a drag cannot start while a select transition is in flight", async () => {
    getWorkItemTransitions.mockResolvedValue(offers);
    let finish: (value: unknown) => void = () => {};
    transitionWorkItem.mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    );
    board({ canTransition: true, canRank: true });
    await chooseDone();
    fireEvent.click(
      screen.getByRole("button", { name: "Move WLP-1 to the chosen state" }),
    );
    await waitFor(() => expect(transitionWorkItem).toHaveBeenCalledTimes(1));
    fireEvent.dragStart(card("WLP-3"));
    fireEvent.drop(card("WLP-1"));
    await Promise.resolve();
    expect(rankWorkItem).not.toHaveBeenCalled();
    expect(getWorkItemTransitions).toHaveBeenCalledTimes(1);
    finish({});
  });

  it("a select transition is ignored while a rank move is in flight", async () => {
    getWorkItemTransitions.mockResolvedValue(offers);
    let finish: (value: unknown) => void = () => {};
    rankWorkItem.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    board({ canTransition: true, canRank: true });
    await chooseDone();
    fireEvent.click(
      screen.getByRole("button", { name: "Move down: WLP-1 in Open" }),
    );
    await waitFor(() => expect(rankWorkItem).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: "Move WLP-1 to the chosen state" }),
    ).toBeDisabled();
    expect(transitionWorkItem).not.toHaveBeenCalled();
    finish({});
  });

  it("a 400 from a transition does not claim a position was not saved", async () => {
    getWorkItemTransitions.mockResolvedValue(offers);
    transitionWorkItem.mockRejectedValue(new HttpError(400, "x"));
    board({ canTransition: true });
    await chooseDone();
    fireEvent.click(
      screen.getByRole("button", { name: "Move WLP-1 to the chosen state" }),
    );
    const alert = await screen.findByTestId("work-item-board-error");
    expect(alert).toHaveTextContent(
      "The state change for WLP-1 was not valid. The board was refreshed.",
    );
    expect(alert).not.toHaveTextContent("position");
  });

  it.each([
    [404, "WLP-1 is no longer available to you."],
    [409, "WLP-1 changed in the meantime"],
    [422, "WLP-1 can't be moved right now because a rule blocks it."],
  ])("HTTP %i from transition is reported", async (status, text) => {
    getWorkItemTransitions.mockResolvedValue(offers);
    transitionWorkItem.mockRejectedValue(new HttpError(status, "x"));
    board({ canTransition: true });
    await chooseDone();
    fireEvent.click(
      screen.getByRole("button", { name: "Move WLP-1 to the chosen state" }),
    );
    expect(
      await screen.findByTestId("work-item-board-error"),
    ).toHaveTextContent(text);
  });
});

describe("selection", () => {
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
