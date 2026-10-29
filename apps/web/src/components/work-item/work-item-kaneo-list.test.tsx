import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type { WorkItemRow } from "@/types/work-item";
import loadVirtualizedSortableList from "./load-virtualized-sortable-list";
import loadWorkItemInlineFields from "./load-work-item-inline-fields";
import WorkItemKaneoList from "./work-item-kaneo-list";

// The grouped list renders once its row code is loaded (the table shows until then).
beforeAll(async () => {
  await Promise.all([
    loadVirtualizedSortableList(),
    loadWorkItemInlineFields(),
  ]);
});

const preference = vi.hoisted(() => ({
  set: vi.fn(),
  initial: undefined as string[] | undefined,
}));

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  rank: vi.fn(),
  transition: vi.fn(),
  offers: vi.fn(),
  invalidate: vi.fn(),
  permission: vi.fn(),
  canRank: false,
  canTransition: false,
  canCreate: false,
  checking: false,
  drag: undefined as Record<string, unknown> | undefined,
  states: {
    data: [
      { id: "open", name: "Open", group: "started" },
      { id: "done", name: "Done", group: "completed" },
      { id: "empty", name: "Waiting", group: "unstarted" },
    ],
    isError: false,
    isLoading: false,
  },
}));
vi.mock("@/hooks/use-project-view-preference", async (importOriginal) => {
  const React = await import("react");
  return {
    ...(await importOriginal<
      typeof import("@/hooks/use-project-view-preference")
    >()),
    // Stands in for the settings round trip: keeps what the list stores and reports each write.
    useProjectViewPreference: () => {
      const [value, setValue] = React.useState<string[] | undefined>(
        preference.initial,
      );
      return {
        value,
        set: (next: string[] | null) => {
          preference.set(next);
          setValue(next ?? undefined);
        },
      };
    },
  };
});
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => {
      mocks.drag = props as unknown as Record<string, unknown>;
      return <actual.DndContext {...props} />;
    },
  };
});
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (...args: unknown[]) => {
    mocks.permission(...args);
    return {
      isCheckingPermissions: mocks.checking,
      canRankTasks: () => mocks.canRank,
      canTransitionTasks: () => mocks.canTransition,
      canCreateTasks: () => mocks.canCreate,
    };
  },
}));
vi.mock("@/fetchers/work-item/rank-work-item", () => ({
  default: (...args: unknown[]) => mocks.rank(...args),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: (...args: unknown[]) => mocks.transition(...args),
}));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: (...args: unknown[]) => mocks.offers(...args),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/queries/project/use-get-project-states", () => ({
  default: () => mocks.states,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("./work-item-list", () => ({
  default: () => <div data-testid="table-fallback">Table fallback</div>,
}));
vi.mock("./work-item-inline-fields", () => ({
  default: ({
    children,
  }: {
    children: (slots: {
      stateControl: ReactNode;
      priorityControl: ReactNode;
      assigneeControl: ReactNode;
    }) => ReactNode;
  }) =>
    children({
      stateControl: null,
      priorityControl: null,
      assigneeControl: null,
    }),
}));

function item(key: string, stateId: string): WorkItemRow {
  return {
    id: `id-${key}`,
    key,
    number: Number(key.split("-")[1]),
    projectId: "project-1",
    workspaceId: "workspace-1",
    typeId: "type-1",
    requesterId: null,
    parentId: null,
    customerVisibility: "private",
    archivedAt: null,
    deletedAt: null,
    stateCategory: "started",
    title: `Title ${key}`,
    description: null,
    stateId,
    stateName: stateId,
    priority: null,
    assigneeId: null,
    assigneeName: null,
    position: "1",
    startDate: null,
    dueDate: null,
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
    version: 1,
    unavailableFields: [],
  };
}
const baseProps = () => ({
  projectId: "project-1",
  workspaceId: "workspace-1",
  workItems: [item("WLP-1", "open"), item("WLP-2", "done")],
  hasPartialFailure: false,
  isLoading: false,
  isError: false,
  sort: "key" as const,
  dir: "asc" as const,
  onSortChange: vi.fn(),
  onRetry: vi.fn(),
});

afterEach(cleanup);
beforeEach(() => {
  mocks.navigate.mockClear();
  mocks.rank.mockReset();
  mocks.rank.mockResolvedValue({});
  mocks.transition.mockReset();
  mocks.transition.mockResolvedValue({});
  mocks.offers.mockReset();
  mocks.offers.mockResolvedValue([]);
  mocks.invalidate.mockReset();
  mocks.invalidate.mockResolvedValue(undefined);
  mocks.permission.mockClear();
  preference.set.mockReset();
  preference.initial = undefined;
  mocks.canRank = false;
  mocks.canTransition = false;
  mocks.canCreate = false;
  mocks.checking = false;
  useBulkSelectionStore.setState({
    selectedTaskIds: new Set(),
    focusedTaskId: null,
  });
});

describe("canonical Kaneo grouped list", () => {
  it("shows persisted records in Kaneo state sections including empty states and real detail links", () => {
    render(<WorkItemKaneoList {...baseProps()} />);
    expect(screen.getByRole("button", { name: /^Open\s*1$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Done\s*1$/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /^Waiting\s*0$/ })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "WLP-1 Title WLP-1" }),
    ).toHaveAttribute("href", "/agent/work-items/WLP-1");
    expect(
      screen.queryByTitle("tasks:listView.addTask"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTitle("tasks:listView.archiveAllTooltip"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Open\s*1$/ }));
    expect(
      screen.queryByRole("link", { name: "WLP-1 Title WLP-1" }),
    ).not.toBeInTheDocument();
  });

  it("P1R2-2: restores Kaneo's '+' on every state section, including an empty one, for a creator", () => {
    const onCreateInState = vi.fn();
    mocks.canCreate = true;
    render(
      <WorkItemKaneoList {...baseProps()} onCreateInState={onCreateInState} />,
    );
    const buttons = screen.getAllByRole("button", {
      name: /^tasks:listView.addTask: /,
    });
    expect(buttons).toHaveLength(3);
    for (const button of buttons) expect(button).not.toHaveAttribute("title");
    fireEvent.click(buttons[2] as HTMLElement);
    expect(onCreateInState).toHaveBeenCalledExactlyOnceWith(
      { id: "empty", name: "Waiting" },
      buttons[2],
    );
  });

  it("P1R2-2: hides the section '+' without create permission", () => {
    render(<WorkItemKaneoList {...baseProps()} onCreateInState={vi.fn()} />);
    expect(
      screen.queryByTitle("tasks:listView.addTask"),
    ).not.toBeInTheDocument();
  });

  it("shows the SLA badge only on rows that have one (VW-16)", () => {
    const withSla = {
      ...item("WLP-1", "open"),
      sla: {
        metric: "resolution" as const,
        state: "at_risk" as const,
        dueAt: "2026-10-23T12:00:00Z",
        remainingMinutes: 90,
        consumedPct: 80,
      },
    };
    render(
      <WorkItemKaneoList
        {...baseProps()}
        workItems={[withSla, item("WLP-2", "done")]}
      />,
    );
    const badges = screen.getAllByTestId("work-item-sla-badge");
    expect(badges).toHaveLength(1);
    expect(badges[0]).toHaveAttribute("data-sla-state", "at_risk");
    expect(badges[0].closest("[data-task-id]")).toHaveAttribute(
      "data-task-id",
      "id-WLP-1",
    );
  });

  it("stores a collapsed group as a per-user preference and restores it (VW-15)", () => {
    const { unmount } = render(<WorkItemKaneoList {...baseProps()} />);
    fireEvent.click(screen.getByRole("button", { name: /^Open\s*1$/ }));
    expect(preference.set).toHaveBeenLastCalledWith(["open"]);

    fireEvent.click(screen.getByRole("button", { name: /^Open\s*1$/ }));
    expect(preference.set).toHaveBeenLastCalledWith(null);
    unmount();

    preference.initial = ["done"];
    render(<WorkItemKaneoList {...baseProps()} />);
    expect(screen.getByRole("button", { name: /^Done\s*1$/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /^Open\s*1$/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("opens a normal title or row in the route-owned sheet while keeping real modified links", () => {
    const onOpenItem = vi.fn();
    render(<WorkItemKaneoList {...baseProps()} onOpenItem={onOpenItem} />);
    const title = screen.getByRole("link", { name: "WLP-1 Title WLP-1" });
    expect(fireEvent.click(title)).toBe(false);
    expect(onOpenItem).toHaveBeenLastCalledWith("WLP-1");
    fireEvent.click(screen.getByText("WLP-2"));
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
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(title).toHaveAttribute("href", "/agent/work-items/WLP-1");
  });

  it("keeps bulk selection in route scope and pagination available", () => {
    const onSelectionChange = vi.fn();
    const onLoadMore = vi.fn();
    render(
      <WorkItemKaneoList
        {...baseProps()}
        canBulkAssign
        selectedKeys={[]}
        onSelectionChange={onSelectionChange}
        hasMore
        onLoadMore={onLoadMore}
      />,
    );
    const row = screen
      .getByRole("link", { name: "WLP-1 Title WLP-1" })
      .closest("[data-task-id]");
    expect(row).not.toBeNull();
    fireEvent.click(within(row as HTMLElement).getByText("WLP-1"), {
      ctrlKey: true,
    });
    expect(onSelectionChange).toHaveBeenCalledWith("WLP-1", true);
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
    fireEvent.click(screen.getByTestId("work-item-list-load-more"));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it("does not permit selection without the bulk capability", () => {
    const onSelectionChange = vi.fn();
    render(
      <WorkItemKaneoList
        {...baseProps()}
        onSelectionChange={onSelectionChange}
      />,
    );
    const key = screen.getByText("WLP-1");
    fireEvent.click(key, { ctrlKey: true });
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(useBulkSelectionStore.getState().selectedTaskIds.size).toBe(0);
  });

  it.each([
    { hasPartialFailure: true },
    { isError: true },
    { workItems: [] },
    { workItems: [item("WLP-3", "retired-state")] },
  ])("preserves existing table recovery semantics for %o", (override) => {
    render(<WorkItemKaneoList {...baseProps()} {...override} />);
    expect(screen.getByTestId("table-fallback")).toBeVisible();
  });
});

function event(name: string, value: unknown) {
  const handler = mocks.drag?.[name];
  if (typeof handler !== "function") throw new Error(`missing ${name}`);
  return handler(value);
}
async function dragRow(source: string, target: string) {
  const active = { id: `id-${source}` };
  act(() =>
    event("onDragStart", {
      active,
      activatorEvent: new MouseEvent("mousedown"),
    }),
  );
  await act(async () => {
    await event("onDragEnd", {
      active,
      over: { id: target.startsWith("WLP-") ? `id-${target}` : target },
    });
  });
}
const rankedRows = () => [
  item("WLP-1", "open"),
  { ...item("WLP-2", "open"), position: "2" },
  item("WLP-3", "done"),
];

describe("canonical list uses the shared canonical DnD controller", () => {
  it("uses original list sensors and real project-scoped capability inputs", () => {
    render(<WorkItemKaneoList {...baseProps()} />);
    expect(mocks.permission).toHaveBeenCalledWith("workspace-1", "project-1");
    const sensors = mocks.drag?.sensors as {
      sensor: { name: string };
      options: unknown;
    }[];
    expect(sensors.map((entry) => entry.sensor.name)).toEqual([
      "MouseSensor",
      "TouchSensor",
      "KeyboardSensor",
    ]);
    expect(sensors[0].options).toEqual({
      activationConstraint: { distance: 8 },
    });
    expect(sensors[1].options).toEqual({
      activationConstraint: { delay: 200, tolerance: 8 },
    });
    expect(sensors[2].options).toMatchObject({
      keyboardCodes: {
        start: ["Space"],
        end: ["Space", "Enter"],
        cancel: ["Escape"],
      },
    });
    expect(sensors[2].options).toHaveProperty("coordinateGetter");
  });
  it("does not persist ranks from a same-project placeholder ordering", async () => {
    mocks.canRank = true;
    render(
      <WorkItemKaneoList
        {...baseProps()}
        sort="position"
        isPlaceholderData
        workItems={rankedRows()}
      />,
    );
    await dragRow("WLP-1", "WLP-2");
    expect(mocks.rank).not.toHaveBeenCalled();
  });
  it("keeps loaded rows visible and retries a failed next page with Kaneo controls", () => {
    const onLoadMore = vi.fn();
    render(
      <WorkItemKaneoList
        {...baseProps()}
        hasMore
        isLoadMoreError
        onLoadMore={onLoadMore}
      />,
    );
    expect(screen.getByTestId("work-item-list-page-error")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("work-item-list-load-more"));
    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(screen.getByTestId("work-item-list-populated")).toBeInTheDocument();
  });
  it("ranks real rows in both directions only for ascending position", async () => {
    mocks.canRank = true;
    render(
      <WorkItemKaneoList
        {...baseProps()}
        sort="position"
        workItems={rankedRows()}
      />,
    );
    await dragRow("WLP-1", "WLP-2");
    expect(mocks.rank).toHaveBeenLastCalledWith({
      key: "WLP-1",
      beforeId: "id-WLP-2",
    });
    await dragRow("WLP-2", "WLP-1");
    expect(mocks.rank).toHaveBeenLastCalledWith({
      key: "WLP-2",
      afterId: "id-WLP-1",
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "project-1"],
    });
    expect(mocks.transition).not.toHaveBeenCalled();
  });
  it.each([
    { sort: "title", dir: "asc" },
    { sort: "position", dir: "desc" },
  ])("never writes hidden rank under %j", async ({ sort, dir }) => {
    mocks.canRank = true;
    mocks.canTransition = true;
    mocks.offers.mockResolvedValue([
      {
        toStateId: "done",
        toStateTemplateId: "template-done",
        available: true,
        blockedBy: [],
      },
    ]);
    render(
      <WorkItemKaneoList
        {...baseProps()}
        sort={sort as "title" | "position"}
        dir={dir as "asc" | "desc"}
        workItems={rankedRows()}
      />,
    );
    await dragRow("WLP-1", "WLP-2");
    expect(mocks.rank).not.toHaveBeenCalled();
    await dragRow("WLP-1", "done");
    expect(mocks.transition).toHaveBeenCalledWith({
      key: "WLP-1",
      toStateTemplateId: "template-done",
    });
    expect(mocks.rank).not.toHaveBeenCalled();
  });
  it("moves through an offered edge before placing in the target state", async () => {
    mocks.canRank = true;
    mocks.canTransition = true;
    mocks.offers.mockResolvedValue([
      {
        toStateId: "done",
        toStateTemplateId: "template-done",
        available: true,
        blockedBy: [],
      },
    ]);
    render(
      <WorkItemKaneoList
        {...baseProps()}
        sort="position"
        workItems={rankedRows()}
      />,
    );
    await dragRow("WLP-1", "done");
    expect(mocks.offers).toHaveBeenCalledWith("WLP-1");
    expect(mocks.transition).toHaveBeenCalledWith({
      key: "WLP-1",
      toStateTemplateId: "template-done",
    });
    expect(mocks.rank).toHaveBeenCalledWith({
      key: "WLP-1",
      beforeId: "id-WLP-3",
    });
    expect(mocks.transition.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rank.mock.invocationCallOrder[0],
    );
  });
  it.each([
    { offers: [], expected: "workItems:board.transitionUnavailable" },
    {
      offers: [
        {
          toStateId: "done",
          available: false,
          blockedBy: [{ reasonCode: "cab.pending" }],
        },
      ],
      expected: "workItems:board.transitionBlocked",
    },
  ])(
    "shows genuine $expected and never mutates",
    async ({ offers, expected }) => {
      mocks.canTransition = true;
      mocks.offers.mockResolvedValue(offers);
      render(<WorkItemKaneoList {...baseProps()} />);
      await dragRow("WLP-1", "done");
      expect(screen.getByTestId("work-item-list-drag-error")).toHaveTextContent(
        expected,
      );
      expect(
        screen.getByTestId("work-item-list-drag-error"),
      ).not.toHaveTextContent("cab.pending");
      expect(mocks.transition).not.toHaveBeenCalled();
      expect(mocks.rank).not.toHaveBeenCalled();
    },
  );
  it("fails closed during capability loading or refusal", async () => {
    mocks.canRank = true;
    mocks.canTransition = true;
    mocks.checking = true;
    render(<WorkItemKaneoList {...baseProps()} sort="position" />);
    await dragRow("WLP-1", "done");
    expect(mocks.offers).not.toHaveBeenCalled();
    expect(mocks.rank).not.toHaveBeenCalled();
  });
  it("starts an actual keyboard sensor drag with the original compact row preview, then cancels", async () => {
    mocks.canRank = true;
    render(<WorkItemKaneoList {...baseProps()} sort="position" />);
    const title = screen.getByRole("link", { name: "WLP-1 Title WLP-1" });
    const row = title.closest("fieldset");
    if (!row) throw new Error("missing original row activator");
    (row as HTMLElement).focus();
    fireEvent.keyDown(row, { key: " ", code: "Space" });
    expect(
      await screen.findByTestId("list-task-drag-preview"),
    ).toHaveTextContent("Title WLP-1");
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(mocks.rank).not.toHaveBeenCalled();
  });
});

it("preserves structured-search key order and refuses hidden ranking when position is requested", async () => {
  mocks.canRank = true;
  mocks.canTransition = true;
  mocks.offers.mockResolvedValue([
    {
      toStateId: "done",
      toStateTemplateId: "template-done",
      available: true,
      blockedBy: [],
    },
  ]);
  const rows = rankedRows().map((row) =>
    row.key === "WLP-1" ? { ...row, position: "100" } : row,
  );
  render(
    <WorkItemKaneoList
      {...baseProps()}
      sort="position"
      isFiltered
      workItems={rows}
    />,
  );
  const titles = screen.getAllByRole("link").map((link) => link.textContent);
  expect(titles).toEqual(["Title WLP-1", "Title WLP-2", "Title WLP-3"]);
  await dragRow("WLP-1", "WLP-2");
  expect(mocks.rank).not.toHaveBeenCalled();
  await dragRow("WLP-1", "done");
  expect(mocks.transition).toHaveBeenCalledWith({
    key: "WLP-1",
    toStateTemplateId: "template-done",
  });
  expect(mocks.rank).not.toHaveBeenCalled();
});
