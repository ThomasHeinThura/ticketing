import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import type { WorkItemRow } from "@/types/work-item";
import useWorkItemDragDrop from "./use-work-item-drag-drop";

const mocks = vi.hoisted(() => ({
  offers: vi.fn(),
  transition: vi.fn(),
  rank: vi.fn(),
  children: vi.fn(),
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
function end(hook: MountedDragHook, target = "done") {
  return hook.result.current.endDrag({
    active: { id: "one" },
    over: { id: target },
  } as DragEndEvent);
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
  expect(hook.result.current.busy).toBe(false);
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
  expect(mocks.offers).not.toHaveBeenCalled();
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
  expect(mocks.offers).not.toHaveBeenCalled();
  expect(mocks.rank).not.toHaveBeenCalled();
});

function Harness({
  onReady,
}: {
  onReady: (hook: ReturnType<typeof useWorkItemDragDrop>) => void;
}) {
  const hook = useWorkItemDragDrop(options());
  onReady(hook);
  return <>{hook.childrenDialog}</>;
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
  return { drop };
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
  const { drop } = await dropOnClosedColumn();
  act(() => screen.getByRole("button", { name: "Cancel" }).click());
  await drop;
  expect(mocks.transition).not.toHaveBeenCalled();
});
