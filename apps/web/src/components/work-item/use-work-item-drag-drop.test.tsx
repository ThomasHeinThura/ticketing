import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { translate } from "@/test/en-translation";
import type { WorkItemRow } from "@/types/work-item";
import useWorkItemDragDrop from "./use-work-item-drag-drop";

const mocks = vi.hoisted(() => ({
  offers: vi.fn(),
  transition: vi.fn(),
  rank: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: (...args: unknown[]) => mocks.offers(...args),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: (...args: unknown[]) => mocks.transition(...args),
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
function start(hook: ReturnType<typeof mount>, id = "one") {
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
function end(hook: ReturnType<typeof mount>, target = "done") {
  return hook.result.current.endDrag({
    active: { id: "one" },
    over: { id: target },
  } as DragEndEvent);
}
beforeEach(() => {
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
