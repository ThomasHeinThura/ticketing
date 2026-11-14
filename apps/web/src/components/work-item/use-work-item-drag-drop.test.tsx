import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemTransitionBlockedError } from "@/lib/work-item-transition-reasons";
import { translate } from "@/test/en-translation";
import type { WorkItemRow } from "@/types/work-item";
import useWorkItemDragDrop from "./use-work-item-drag-drop";

const mocks = vi.hoisted(() => ({
  offers: vi.fn(),
  transition: vi.fn(),
  rank: vi.fn(),
  children: vi.fn(),
  toastError: vi.fn(),
}));
// A refused move is explained in a library toast.
vi.mock("@/lib/toast", () => ({
  toast: { error: (...args: unknown[]) => mocks.toastError(...args) },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: (...args: unknown[]) => mocks.offers(...args),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: (...args: unknown[]) => mocks.transition(...args),
}));
vi.mock("@/fetchers/work-item/get-hierarchy-children", () => ({
  getHierarchyChildren: (...args: unknown[]) => mocks.children(...args),
}));
vi.mock("@/fetchers/work-item/rank-work-item", () => ({
  default: (...args: unknown[]) => mocks.rank(...args),
}));
const rows = [
  {
    id: "one",
    key: "HELP-1",
    projectId: "project",
    stateId: "open",
    position: "1",
    unavailableFields: [],
  },
  {
    id: "two",
    key: "HELP-2",
    projectId: "project",
    stateId: "open",
    position: "2",
    unavailableFields: [],
  },
  {
    id: "three",
    key: "HELP-3",
    projectId: "project",
    stateId: "done",
    position: "1",
    unavailableFields: [],
  },
].map((row, index) => ({
  ...row,
  workspaceId: "workspace",
  typeId: "type",
  number: index + 1,
  title: `Work ${index + 1}`,
  description: null,
  priority: null,
  assigneeId: null,
  assigneeName: null,
  stateName: row.stateId,
  stateCategory: "started",
  requesterId: null,
  parentId: null,
  customerVisibility: "private",
  archivedAt: null,
  deletedAt: null,
  startDate: null,
  dueDate: null,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
  version: 1,
})) satisfies WorkItemRow[];
const options = () => ({
  projectId: "project",
  states: [
    { id: "open", name: "Open" },
    { id: "done", name: "Done" },
  ],
  workItems: rows,
  canRank: true,
  canTransition: true,
});
const offer = [
  {
    toStateId: "done",
    toStateTemplateId: "template",
    available: true,
    blockedBy: [],
  },
];
function mount() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const hook = renderHook((props) => useWorkItemDragDrop(props), {
    initialProps: options(),
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...hook, invalidate };
}
type MountedDragHook = Pick<ReturnType<typeof mount>, "result">;

it("does not read computed styles while rendering the drag hook", () => {
  const computedStyle = vi.spyOn(window, "getComputedStyle");
  try {
    mount();
    expect(computedStyle).not.toHaveBeenCalled();
  } finally {
    computedStyle.mockRestore();
  }
});

function start(hook: MountedDragHook, id = "one") {
  act(() =>
    hook.result.current.startDrag({
      active: {
        id,
        data: { current: undefined },
        rect: { current: { initial: null, translated: null } },
      },
      activatorEvent: new MouseEvent("mousedown"),
    } satisfies DragStartEvent),
  );
}
function end(hook: MountedDragHook, target = "done", id = "one") {
  return hook.result.current.endDrag({
    active: { id },
    over: { id: target },
  } as DragEndEvent);
}
function itemIds(
  hook: Pick<ReturnType<typeof useWorkItemDragDrop>, "itemsByState">,
  state: string,
) {
  return hook.itemsByState.get(state)?.map((row) => row.id);
}
function combinedRows(firstProjectId = "project", secondProjectId = "project") {
  const [first, second, third] = rows;
  if (!first || !second || !third) throw new Error("Combined rows missing");
  return [
    {
      ...first,
      stateTemplateId: "open-template",
      sourceProject: { id: firstProjectId, key: "HELP", name: "Help" },
    },
    {
      ...second,
      projectId: secondProjectId,
      stateTemplateId: "open-template",
      sourceProject: { id: secondProjectId, key: "CHILD", name: "Child" },
    },
    {
      ...third,
      stateTemplateId: "done-template",
      sourceProject: { id: firstProjectId, key: "HELP", name: "Help" },
    },
  ];
}
function mountCombined(projectId = "project", workItems = combinedRows()) {
  const client = new QueryClient();
  const hook = renderHook((props) => useWorkItemDragDrop(props), {
    initialProps: {
      projectId,
      states: [
        { id: "open-template", name: "Open" },
        { id: "done-template", name: "Done" },
      ],
      workItems,
      canRank: true,
      canTransition: true,
      combined: true,
      canRankForProject: () => true,
      canTransitionForProject: () => true,
    },
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return hook;
}
beforeEach(() => {
  mocks.toastError.mockReset();
  mocks.children.mockReset();
  mocks.children.mockResolvedValue({
    data: [],
    progress: { total: 0, completed: 0 },
  });
  mocks.offers.mockReset();
  mocks.offers.mockResolvedValue(offer);
  mocks.rank.mockReset();
  mocks.rank.mockResolvedValue({});
  mocks.transition.mockReset();
  mocks.transition.mockResolvedValue({});
});
afterEach(cleanup);
it("keeps sensors and the drop animation stable across renders and drag start", () => {
  const hook = mount();
  const { sensors, dropAnimation } = hook.result.current;
  hook.rerender(options());
  start(hook);
  expect(hook.result.current.sensors).toBe(sensors);
  expect(hook.result.current.dropAnimation).toBe(dropAnimation);
});
it("does not POST an old project's offer after the route changes while reading it", async () => {
  let resolve!: (value: unknown) => void;
  mocks.offers.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const hook = mount();
  start(hook);
  let pending!: Promise<void>;
  act(() => {
    pending = end(hook);
  });
  hook.rerender({ ...options(), projectId: "another-project", workItems: [] });
  await act(async () => {
    resolve(offer);
    await pending;
  });
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.rank).not.toHaveBeenCalled();
  expect(hook.result.current.notice).toBeUndefined();
  expect(hook.result.current.pendingItemIds.size).toBe(0);
});
it("refreshes a committed old-project transition but never starts its second rank after a route change", async () => {
  let resolve!: (value: unknown) => void;
  mocks.transition.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const hook = mount();
  start(hook);
  let pending!: Promise<void>;
  await act(async () => {
    pending = end(hook);
    await Promise.resolve();
  });
  expect(mocks.transition).toHaveBeenCalledOnce();
  hook.rerender({ ...options(), projectId: "another-project", workItems: [] });
  await act(async () => {
    resolve({});
    await pending;
  });
  expect(mocks.rank).not.toHaveBeenCalled();
  expect(hook.invalidate).toHaveBeenCalledWith({
    queryKey: ["work-items", "project"],
  });
  expect(hook.result.current.notice).toBeUndefined();
});

it("denies shared-template rank across projects", async () => {
  const hook = mountCombined("project", combinedRows("project", "child"));
  start(hook, "one");
  await act(async () => {
    await hook.result.current.endDrag({
      active: { id: "one" },
      over: { id: "two" },
    } as DragEndEvent);
  });
  expect(mocks.rank).not.toHaveBeenCalled();
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(hook.result.current.notice?.kind).toBe("error");
  expect(hook.result.current.notice?.text).toBe(
    translate("workItems:board.crossProjectRankDenied"),
  );
});

it("ranks shared-template cards only within the source project's concrete state", async () => {
  const sameProject = combinedRows();
  const second = sameProject[1];
  if (!second) throw new Error("Combined target row missing");
  sameProject[1] = {
    ...second,
    projectId: "project",
    stateId: "open",
    sourceProject: { id: "project", key: "HELP", name: "Help" },
  };
  const hook = mountCombined("project", sameProject);
  start(hook, "one");
  await act(async () => {
    await hook.result.current.endDrag({
      active: { id: "one" },
      over: { id: "two" },
    } as DragEndEvent);
  });
  expect(mocks.rank).toHaveBeenCalledWith({
    key: "HELP-1",
    beforeId: "two",
  });
  expect(mocks.transition).not.toHaveBeenCalled();
});

it("resolves combined column transitions from the item's real project offer", async () => {
  const [transitionOffer] = offer;
  if (!transitionOffer) throw new Error("Transition offer missing");
  mocks.offers.mockResolvedValue([
    { ...transitionOffer, toStateTemplateId: "done-template" },
  ]);
  const hook = mountCombined();
  start(hook, "one");
  await act(async () => {
    await hook.result.current.endDrag({
      active: { id: "one" },
      over: { id: "done-template" },
    } as DragEndEvent);
  });
  expect(mocks.offers).toHaveBeenCalledWith("HELP-1");
  expect(mocks.transition).toHaveBeenCalledWith({
    key: "HELP-1",
    toStateTemplateId: "done-template",
  });
});
it("does not mutate a source that disappeared or changed state during a drag", async () => {
  const hook = mount();
  start(hook);
  hook.rerender({
    ...options(),
    workItems: rows.filter((row) => row.id !== "one"),
  });
  await act(async () => {
    await end(hook);
  });
  hook.rerender(options());
  start(hook);
  hook.rerender({
    ...options(),
    workItems: rows.map((row) =>
      row.id === "one" ? { ...row, stateId: "done" } : row,
    ),
  });
  await act(async () => {
    await end(hook);
  });
  // The offers are fetched when a drag starts (so the drop does not wait for them); what must
  // never happen is a write for a source that is gone or changed.
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.rank).not.toHaveBeenCalled();
});
it("refuses rows outside the addressed project and loss of both capabilities mid-drag", async () => {
  const hook = mount();
  hook.rerender({ ...options(), projectId: "foreign-project" });
  start(hook);
  await act(async () => {
    await end(hook);
  });
  hook.rerender(options());
  start(hook);
  hook.rerender({ ...options(), canRank: false, canTransition: false });
  await act(async () => {
    await end(hook);
  });
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.rank).not.toHaveBeenCalled();
});

function Harness({
  onReady,
}: {
  onReady: (hook: ReturnType<typeof useWorkItemDragDrop>) => void;
}) {
  const hook = useWorkItemDragDrop(options());
  onReady(hook);
  return (
    <>
      {hook.childrenDialog}
      {hook.noteDialog}
    </>
  );
}
async function dropOnClosedColumn() {
  mocks.offers.mockResolvedValue([
    { ...offer[0], toStateCategory: "completed" },
  ]);
  mocks.children.mockResolvedValue({
    data: [
      {
        key: "HELP-9",
        title: "Child",
        stateName: "Open",
        stateCategory: "unstarted",
      },
    ],
    progress: { total: 1, completed: 0 },
  });
  let current!: ReturnType<typeof useWorkItemDragDrop>;
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <Harness onReady={(hook) => (current = hook)} />
    </QueryClientProvider>,
  );
  act(() =>
    current.startDrag({
      active: {
        id: "one",
        data: { current: undefined },
        rect: { current: { initial: null, translated: null } },
      },
      activatorEvent: new MouseEvent("mousedown"),
    } satisfies DragStartEvent),
  );
  const drop = current.endDrag({
    active: { id: "one" },
    over: { id: "done" },
  } as DragEndEvent);
  await screen.findByTestId("open-children-warning");
  return { drop, hook: () => current };
}
it("RH-10: dropping a parent into a closed column waits for the open-children confirmation", async () => {
  const { drop } = await dropOnClosedColumn();
  expect(mocks.transition).not.toHaveBeenCalled();
  act(() => screen.getByRole("button", { name: "Close anyway" }).click());
  await drop;
  await waitFor(() =>
    expect(mocks.transition).toHaveBeenCalledWith({
      key: "HELP-1",
      toStateTemplateId: "template",
    }),
  );
});
it("RH-10: cancelling the open-children warning leaves the card in place", async () => {
  const { drop, hook } = await dropOnClosedColumn();
  // While the question is open the card already waits in the column it was dropped on.
  expect(itemIds(hook(), "done")).toEqual(["three", "one"]);
  await act(async () => {
    screen.getByRole("button", { name: "Cancel" }).click();
    await drop;
  });
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(itemIds(hook(), "open")).toEqual(["one", "two"]);
  expect(itemIds(hook(), "done")).toEqual(["three"]);
  expect(hook().pendingItemIds.size).toBe(0);
  expect(mocks.toastError).not.toHaveBeenCalled();
});

it.each([true, false])(
  "required transition note: cancel or submit (cancel=%s)",
  async (cancel) => {
    mocks.offers.mockResolvedValue([
      {
        ...offer[0],
        notePolicy: "required",
        available: false,
        blockedBy: [{ reasonCode: "note.required" }],
      },
    ]);
    let current!: ReturnType<typeof useWorkItemDragDrop>;
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <Harness
          onReady={(hook) => {
            current = hook;
          }}
        />
      </QueryClientProvider>,
    );
    start({ result: { current } } as MountedDragHook);
    let drop!: Promise<void>;
    act(() => {
      drop = current.endDrag({
        active: { id: "one" },
        over: { id: "done" },
      } as DragEndEvent);
    });
    const input = await screen.findByRole("textbox", {
      name: translate("workItems:properties.transitionNote"),
    });
    expect(itemIds(current, "done")).toContain("one");
    expect(mocks.transition).not.toHaveBeenCalled();
    if (cancel) {
      await act(async () => {
        screen
          .getByRole("button", { name: translate("common:actions.cancel") })
          .click();
        await drop;
      });
      expect(itemIds(current, "open")).toContain("one");
      expect(mocks.transition).not.toHaveBeenCalled();
    } else {
      fireEvent.change(input, { target: { value: "Approved" } });
      await act(async () => {
        screen
          .getByRole("button", { name: translate("workItems:properties.move") })
          .click();
        await drop;
      });
      expect(mocks.transition).toHaveBeenCalledWith({
        key: "HELP-1",
        toStateTemplateId: "template",
        note: "Approved",
      });
    }
  },
);

function pendingTransition() {
  let settle!: {
    resolve: (value: unknown) => void;
    reject: (e: unknown) => void;
  };
  mocks.transition.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        settle = { resolve, reject };
      }),
  );
  return {
    resolve: (value: unknown = {}) => settle.resolve(value),
    reject: (e: unknown) => settle.reject(e),
  };
}

it("shows the dropped card in the target column at once, before the server replies", async () => {
  mocks.offers.mockReturnValue(new Promise(() => {}));
  const hook = mount();
  start(hook);
  act(() => {
    void end(hook, "done");
  });
  expect(itemIds(hook.result.current, "done")).toEqual(["three", "one"]);
  expect(itemIds(hook.result.current, "open")).toEqual(["two"]);
  expect(hook.result.current.pendingItemIds.has("one")).toBe(true);
  expect(hook.result.current.pendingItemIds.has("two")).toBe(false);
  // The persisted rows are untouched: the position is derived, never cached.
  expect(rows.find((row) => row.id === "one")?.stateId).toBe("open");
});
it("places a same-column reorder at its slot at once", async () => {
  const hook = mount();
  const write = new Promise<unknown>(() => {});
  mocks.rank.mockReturnValue(write);
  start(hook);
  act(() => {
    void end(hook, "two");
  });
  expect(itemIds(hook.result.current, "open")).toEqual(["two", "one"]);
});
it("fetches the transitions when the drag starts, not when it ends", async () => {
  const hook = mount();
  start(hook);
  expect(mocks.offers).toHaveBeenCalledOnce();
  expect(mocks.offers).toHaveBeenCalledWith("HELP-1");
  await act(async () => {
    await end(hook, "done");
  });
  expect(mocks.offers).toHaveBeenCalledOnce();
  expect(mocks.transition).toHaveBeenCalledOnce();
});
it("does not fetch transitions for a person who can only rank, and a viewer cannot drag", async () => {
  const hook = mount();
  hook.rerender({ ...options(), canTransition: false });
  start(hook);
  expect(mocks.offers).not.toHaveBeenCalled();
  act(() => hook.result.current.cancelDrag());
  hook.rerender({ ...options(), canRank: false, canTransition: false });
  start(hook, "two");
  expect(hook.result.current.dragged).toBeUndefined();
  await act(async () => {
    await end(hook, "done", "two");
  });
  expect(mocks.offers).not.toHaveBeenCalled();
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.rank).not.toHaveBeenCalled();
});
const blockedOffer = (reasonCode: string) => [
  { ...offer[0], available: false, blockedBy: [{ reasonCode }] },
];
it.each([
  [
    "a transition the workflow does not offer",
    () => mocks.offers.mockResolvedValue([]),
    translate("workItems:board.transitionUnavailable", { key: "HELP-1" }),
  ],
  [
    "a transition blocked by a guard",
    () => mocks.offers.mockResolvedValue(blockedOffer("note.required")),
    translate("workItems:board.transitionBlocked", {
      key: "HELP-1",
      reason: translate("workItems:journey.reasonNoteRequired"),
    }),
  ],
  [
    "an approval that is still required",
    () =>
      mocks.transition.mockRejectedValue(
        new WorkItemTransitionBlockedError(["approval.pending"]),
      ),
    translate("workItems:board.transitionBlocked", {
      key: "HELP-1",
      reason: translate("workItems:journey.reasonApprovalPending"),
    }),
  ],
  [
    "a 403",
    () => mocks.transition.mockRejectedValue(new HttpError(403, "no")),
    translate("workItems:board.failure.forbidden", { key: "HELP-1" }),
  ],
  [
    "a 409 version conflict",
    () => mocks.transition.mockRejectedValue(new HttpError(409, "conflict")),
    translate("workItems:board.failure.conflict", { key: "HELP-1" }),
  ],
  [
    "a network error",
    () => mocks.transition.mockRejectedValue(new TypeError("Failed to fetch")),
    translate("workItems:board.failure.network", { key: "HELP-1" }),
  ],
])(
  "puts the card back and explains %s in a toast",
  async (_name, arrange, text) => {
    arrange();
    const hook = mount();
    start(hook);
    await act(async () => {
      await end(hook, "done");
    });
    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect(mocks.toastError).toHaveBeenCalledWith(text);
    expect(itemIds(hook.result.current, "open")).toEqual(["one", "two"]);
    expect(itemIds(hook.result.current, "done")).toEqual(["three"]);
    expect(hook.result.current.pendingItemIds.size).toBe(0);
    expect(mocks.rank).not.toHaveBeenCalled();
    // The next drag is accepted straight away.
    mocks.transition.mockResolvedValue({});
    start(hook);
    expect(hook.result.current.dragged?.id).toBe("one");
  },
);
it("keeps the card where it landed when only its position could not be saved", async () => {
  mocks.rank.mockRejectedValue(new HttpError(400, "neighbour left"));
  const hook = mount();
  start(hook);
  await act(async () => {
    await end(hook, "done");
  });
  expect(mocks.transition).toHaveBeenCalledOnce();
  expect(mocks.toastError).toHaveBeenCalledOnce();
  expect(mocks.toastError.mock.calls[0]?.[0]).toContain("moved to Done");
  // The move itself stands, so the card stays in Done until fresh rows arrive.
  expect(itemIds(hook.result.current, "done")).toContain("one");
});
it("sends two quick drops in order, the second placed against the first", async () => {
  const first = pendingTransition();
  const hook = mount();
  start(hook, "one");
  act(() => {
    void end(hook, "done", "one");
  });
  // Another card is dragged and dropped on the unconfirmed one while the first write runs.
  start(hook, "two");
  expect(hook.result.current.dragged?.id).toBe("two");
  let second!: Promise<void>;
  act(() => {
    second = end(hook, "one", "two");
  });
  expect(itemIds(hook.result.current, "done")).toEqual(["three", "two", "one"]);
  await waitFor(() => expect(mocks.transition).toHaveBeenCalledOnce());
  expect(mocks.transition).toHaveBeenCalledWith({
    key: "HELP-1",
    toStateTemplateId: "template",
  });
  // Nothing of the second move is sent until the first has finished.
  expect(mocks.rank).not.toHaveBeenCalled();
  await act(async () => {
    first.resolve();
    await second;
  });
  expect(mocks.transition.mock.calls.map(([input]) => input.key)).toEqual([
    "HELP-1",
    "HELP-2",
  ]);
  expect(mocks.rank.mock.calls.map(([input]) => input)).toEqual([
    { key: "HELP-1", beforeId: "three" },
    { key: "HELP-2", beforeId: "three", afterId: "one" },
  ]);
  const order = [
    mocks.transition.mock.invocationCallOrder[0],
    mocks.rank.mock.invocationCallOrder[0],
    mocks.transition.mock.invocationCallOrder[1],
    mocks.rank.mock.invocationCallOrder[1],
  ];
  expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
  expect(mocks.toastError).not.toHaveBeenCalled();
});
it("recalculates a queued drop after its pending neighbour is refused", async () => {
  const first = pendingTransition();
  const hook = mount();
  start(hook, "one");
  act(() => {
    void end(hook, "done", "one");
  });
  start(hook, "two");
  let second!: Promise<void>;
  act(() => {
    second = end(hook, "one", "two");
  });
  await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(1));
  await act(async () => {
    first.reject(new HttpError(409, "conflict"));
    await second;
  });
  expect(mocks.rank).toHaveBeenCalledWith({ key: "HELP-2", beforeId: "three" });
  expect(itemIds(hook.result.current, "open")).toContain("one");
});

it("recalculates queued neighbours when realtime moves a target away", async () => {
  const first = pendingTransition();
  const hook = mount();
  start(hook, "one");
  act(() => {
    void end(hook, "done", "one");
  });
  start(hook, "two");
  let second!: Promise<void>;
  act(() => {
    second = end(hook, "three", "two");
  });
  await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(1));
  hook.rerender({
    ...options(),
    workItems: rows.map((row) =>
      row.id === "three" ? { ...row, stateId: "open", version: 2 } : row,
    ),
  });
  await act(async () => {
    first.resolve();
    await second;
  });
  expect(mocks.rank).toHaveBeenLastCalledWith({
    key: "HELP-2",
    beforeId: "one",
  });
  expect(
    mocks.rank.mock.calls.every(
      ([input]) => input.beforeId !== "three" && input.afterId !== "three",
    ),
  ).toBe(true);
});

it("ranks combined pending moves in their destination project partition", async () => {
  mocks.offers.mockResolvedValue([
    { ...offer[0], toStateTemplateId: "done-template" },
  ]);
  const first = pendingTransition();
  const initial = combinedRows();
  const hook = mountCombined("project", initial);
  start(hook, "one");
  act(() => {
    void end(hook, "done-template", "one");
  });
  start(hook, "two");
  let second!: Promise<void>;
  act(() => {
    second = end(hook, "one", "two");
  });
  expect(itemIds(hook.result.current, "done-template")).toEqual([
    "three",
    "two",
    "one",
  ]);
  await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(1));
  await act(async () => {
    first.resolve();
    await second;
  });
  expect(mocks.rank.mock.calls.map(([input]) => input)).toEqual([
    { key: "HELP-1", beforeId: "three" },
    { key: "HELP-2", beforeId: "three", afterId: "one" },
  ]);
  hook.rerender({
    projectId: "project",
    states: [
      { id: "open-template", name: "Open" },
      { id: "done-template", name: "Done" },
    ],
    workItems: initial.map((row) =>
      row.id === "one"
        ? {
            ...row,
            stateId: "done",
            stateTemplateId: "done-template",
            position: "3",
            version: 2,
          }
        : row.id === "two"
          ? {
              ...row,
              stateId: "done",
              stateTemplateId: "done-template",
              position: "2",
              version: 2,
            }
          : row,
    ),
    canRank: true,
    canTransition: true,
    combined: true,
    canRankForProject: () => true,
    canTransitionForProject: () => true,
  });
  await waitFor(() => expect(hook.result.current.pendingItemIds.size).toBe(0));
  expect(itemIds(hook.result.current, "done-template")).toEqual([
    "three",
    "two",
    "one",
  ]);
});

it("never ranks a combined move against a different project", async () => {
  mocks.offers.mockResolvedValue([
    { ...offer[0], toStateTemplateId: "done-template" },
  ]);
  const initial = combinedRows("project", "child");
  const original = initial[2];
  if (!original) throw new Error("Missing target");
  const other = {
    ...original,
    id: "four",
    key: "CHILD-4",
    projectId: "child",
    position: "2",
    sourceProject: { id: "child", key: "CHILD", name: "Child" },
  };
  const hook = mountCombined("project", [...initial, other]);
  start(hook, "one");
  await act(async () => {
    await end(hook, "four", "one");
  });
  expect(mocks.rank).toHaveBeenCalledWith({ key: "HELP-1", beforeId: "three" });
  expect(itemIds(hook.result.current, "done-template")).toEqual([
    "three",
    "one",
    "four",
  ]);
});

it("can reorder a combined card against a pending incoming card", async () => {
  mocks.offers.mockResolvedValue([
    { ...offer[0], toStateTemplateId: "done-template" },
  ]);
  const first = pendingTransition();
  const initial = combinedRows().map((row) =>
    row.id === "two"
      ? { ...row, stateId: "done", stateTemplateId: "done-template" }
      : row,
  );
  const hook = mountCombined("project", initial);
  start(hook, "one");
  act(() => {
    void end(hook, "done-template", "one");
  });
  start(hook, "two");
  let second!: Promise<void>;
  act(() => {
    second = end(hook, "one", "two");
  });
  await waitFor(() => expect(mocks.transition).toHaveBeenCalledOnce());
  await act(async () => {
    first.resolve();
    await second;
  });
  expect(mocks.rank).toHaveBeenLastCalledWith({
    key: "HELP-2",
    beforeId: "one",
  });
});

it("only the pending card refuses a drag, and it is released with fresh rows", async () => {
  const write = pendingTransition();
  const hook = mount();
  start(hook, "one");
  let pending!: Promise<void>;
  act(() => {
    pending = end(hook, "done", "one");
  });
  start(hook, "one");
  expect(hook.result.current.dragged).toBeUndefined();
  start(hook, "two");
  expect(hook.result.current.dragged?.id).toBe("two");
  act(() => hook.result.current.cancelDrag());
  await waitFor(() => expect(mocks.transition).toHaveBeenCalledOnce());
  await act(async () => {
    write.resolve();
    await pending;
  });
  // The writes are done, but the rows have not changed yet: the card holds its new place.
  expect(itemIds(hook.result.current, "done")).toContain("one");
  expect(hook.result.current.pendingItemIds.has("one")).toBe(true);
  hook.rerender({
    ...options(),
    workItems: rows.map((row) =>
      row.id === "one"
        ? { ...row, stateId: "done", position: "2", version: 2 }
        : row,
    ),
  });
  await waitFor(() => expect(hook.result.current.pendingItemIds.size).toBe(0));
  expect(itemIds(hook.result.current, "done")).toEqual(["three", "one"]);
});
it("keeps a saved placement until fresh rows arrive", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const hook = mount();
    start(hook);
    await act(async () => {
      await end(hook, "done");
    });
    expect(hook.result.current.pendingItemIds.has("one")).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(hook.result.current.pendingItemIds.has("one")).toBe(true);
    expect(itemIds(hook.result.current, "done")).toContain("one");
    hook.rerender({ ...options(), workItems: rows.map((row) => ({ ...row })) });
    expect(hook.result.current.pendingItemIds.has("one")).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("waits for the version returned by the final write", async () => {
  mocks.transition.mockResolvedValue({ version: 4 });
  mocks.rank.mockResolvedValue({ version: 5 });
  const hook = mount();
  start(hook);
  await act(async () => {
    await end(hook, "done");
  });
  hook.rerender({
    ...options(),
    workItems: rows.map((row) =>
      row.id === "one"
        ? { ...row, stateId: "done", position: "2", version: 4 }
        : row,
    ),
  });
  expect(hook.result.current.pendingItemIds.has("one")).toBe(true);
  hook.rerender({
    ...options(),
    workItems: rows.map((row) =>
      row.id === "one"
        ? { ...row, stateId: "done", position: "2", version: 5 }
        : row,
    ),
  });
  await waitFor(() =>
    expect(hook.result.current.pendingItemIds.has("one")).toBe(false),
  );
});

it("accepts a newer realtime move after the write settles", async () => {
  const hook = mount();
  start(hook);
  await act(async () => {
    await end(hook, "done");
  });
  expect(hook.result.current.pendingItemIds.has("one")).toBe(true);
  hook.rerender({
    ...options(),
    workItems: rows.map((row) =>
      row.id === "one" ? { ...row, stateId: "open", version: 3 } : row,
    ),
  });
  await waitFor(() =>
    expect(hook.result.current.pendingItemIds.has("one")).toBe(false),
  );
  expect(itemIds(hook.result.current, "open")).toContain("one");
});

it("serializes writes for the same project across hook instances", async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const firstHook = renderHook(() => useWorkItemDragDrop(options()), {
    wrapper,
  });
  const secondHook = renderHook(() => useWorkItemDragDrop(options()), {
    wrapper,
  });
  const first = pendingTransition();
  start(firstHook, "one");
  act(() => {
    void end(firstHook, "done", "one");
  });
  start(secondHook, "two");
  let second!: Promise<void>;
  act(() => {
    second = end(secondHook, "done", "two");
  });
  await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(1));
  await act(async () => {
    first.resolve();
    await second;
  });
  expect(mocks.transition.mock.calls.map(([input]) => input.key)).toEqual([
    "HELP-1",
    "HELP-2",
  ]);
});

it("reloads without waiting for the reload", async () => {
  const hook = mount();
  let reloaded = false;
  hook.invalidate.mockImplementation(
    () =>
      new Promise(() => {
        reloaded = true;
      }),
  );
  start(hook);
  await act(async () => {
    await end(hook, "done");
  });
  expect(reloaded).toBe(true);
  expect(hook.invalidate).toHaveBeenCalledWith({
    queryKey: ["work-items", "project"],
  });
  expect(mocks.toastError).not.toHaveBeenCalled();
});
