import { closestCorners } from "@dnd-kit/core";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import {
  boardGroupId,
  boardGroupItemId,
  buildBoardGroups,
} from "@/lib/work-item-board-groups";
import { translate } from "@/test/en-translation";
import type { WorkItemRow } from "@/types/work-item";
import {
  groupedBoardCollisionDetection,
  default as WorkItemGroupedBoard,
} from "./work-item-grouped-board";

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
const updateWorkItem = vi.hoisted(() => vi.fn());
const assignWorkItem = vi.hoisted(() => vi.fn());
const unassignWorkItem = vi.hoisted(() => vi.fn());
const getAssignablePeople = vi.hoisted(() => vi.fn());
const getProjectLabels = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/work-item/get-assignable-people", () => ({
  default: (...args: unknown[]) => getAssignablePeople(...args),
}));
vi.mock("@/fetchers/label/project-labels", () => ({
  getProjectLabels: (...args: unknown[]) => getProjectLabels(...args),
}));
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: (...args: unknown[]) => updateWorkItem(...args),
}));
vi.mock("@/fetchers/work-item/assign-work-item", () => ({
  default: (...args: unknown[]) => assignWorkItem(...args),
}));
vi.mock("@/fetchers/work-item/unassign-work-item", () => ({
  default: (...args: unknown[]) => unassignWorkItem(...args),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      translate(key, options),
  }),
}));
vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (priority: string) =>
    priority.charAt(0).toUpperCase() + priority.slice(1),
}));

function item(key: string, overrides: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: `id-${key}`,
    projectId: "proj_1",
    key,
    number: Number(key.split("-")[1]),
    title: `Title ${key}`,
    stateId: "s-open",
    stateName: "Open",
    priority: null,
    assigneeId: null,
    assigneeName: null,
    version: 4,
    position: "1",
    unavailableFields: [],
    ...overrides,
  } as WorkItemRow;
}

function groupWithValue(
  groups: ReturnType<typeof buildBoardGroups>,
  value: unknown,
) {
  const group = groups.find((candidate) => candidate.value === value);
  if (!group) throw new Error(`Missing group for ${String(value)}`);
  return group;
}

const items = [
  item("WLP-1", { priority: "high", assigneeId: "p-ann", assigneeName: "Ann" }),
  item("WLP-2", { priority: "low" }),
  item("WLP-3", { priority: null, assigneeId: "p-ann", assigneeName: "Ann" }),
];
const people = [
  { personId: "p-ann", name: "Ann" },
  { personId: "p-bo", name: "Bo" },
];

describe("grouped board collision detection", () => {
  it("prefers the pointer's empty group over a card collision", () => {
    const group = buildBoardGroups(
      "label",
      [],
      [],
      undefined,
      [],
      [{ id: "label-c", name: "C", color: "green" }],
    )[0];
    if (!group) throw new Error("Missing label group");
    const cardId = boardGroupItemId(group, "item-1");
    const rect = {
      top: 100,
      bottom: 200,
      left: 100,
      right: 200,
      width: 100,
      height: 100,
    };
    const args = {
      active: {} as never,
      collisionRect: rect,
      droppableRects: new Map([
        [cardId, rect],
        [group.id, rect],
      ]),
      droppableContainers: [{ id: cardId }, { id: group.id }] as never,
      pointerCoordinates: { x: 150, y: 150 },
    } as Parameters<typeof groupedBoardCollisionDetection>[0];

    expect(groupedBoardCollisionDetection(args).map(({ id }) => id)).toEqual([
      group.id,
    ]);
  });

  it("keeps Kaneo keyboard collision behavior when no pointer is available", () => {
    const group = buildBoardGroups("priority", [
      item("WLP-1", { priority: "high" }),
    ])[0];
    if (!group) throw new Error("Missing priority group");
    const rect = {
      top: 100,
      bottom: 200,
      left: 100,
      right: 200,
      width: 100,
      height: 100,
    };
    const args = {
      active: {} as never,
      collisionRect: rect,
      droppableRects: new Map([[group.id, rect]]),
      droppableContainers: [{ id: group.id }] as never,
      pointerCoordinates: null,
    } as Parameters<typeof groupedBoardCollisionDetection>[0];

    expect(groupedBoardCollisionDetection(args)).toEqual(closestCorners(args));
  });
});

type Props = Partial<Parameters<typeof WorkItemGroupedBoard>[0]>;

async function renderBoard(props: Props = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={client}>
      <WorkItemGroupedBoard
        projectId="proj_1"
        field="priority"
        workItems={items}
        peopleEnabled
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        hasMore={false}
        isLoadingMore={false}
        onLoadMore={vi.fn()}
        canSelect={false}
        canAssign
        canUnassignAny
        canUpdate
        canSetPriority
        selectedKeys={[]}
        onSelectionChange={vi.fn()}
        {...props}
      />
    </QueryClientProvider>,
  );
  if (!props.isLoading && !props.isError)
    await waitFor(() =>
      expect(screen.queryByTestId("work-item-board-loading")).toBeNull(),
    );
  return { invalidate };
}

function columns() {
  return screen.getAllByTestId("work-item-board-column");
}
function column(name: string) {
  const match = columns().find(
    (candidate) => within(candidate).queryByRole("heading", { name }) !== null,
  );
  if (!match) throw new Error(`no column ${name}`);
  return match;
}
async function drop(itemKey: string, overId: string, activeId?: string) {
  const handlers = drag.callbacks as {
    onDragStart: (event: unknown) => void;
    onDragEnd: (event: unknown) => Promise<void>;
  };
  act(() => {
    handlers.onDragStart({
      active: { id: activeId ?? `id-${itemKey}` },
      activatorEvent: new MouseEvent("mousedown"),
    });
  });
  await act(async () => {
    await handlers.onDragEnd({
      active: { id: activeId ?? `id-${itemKey}` },
      over: { id: overId },
    });
  });
}

beforeEach(() => {
  updateWorkItem.mockReset().mockResolvedValue({});
  getAssignablePeople.mockReset().mockResolvedValue(people);
  getProjectLabels.mockReset().mockResolvedValue([
    { id: "label-a", name: "Triage", color: "blue" },
    { id: "label-b", name: "Customer", color: "green" },
  ]);
  assignWorkItem.mockReset().mockResolvedValue({});
  unassignWorkItem.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe("WorkItemGroupedBoard (VW-13)", () => {
  it("starts keyboard drags with Space and permits Space or Enter to drop", async () => {
    await renderBoard();
    const sensors = (
      drag.callbacks as {
        sensors: { sensor: { name: string }; options: unknown }[];
      }
    ).sensors;
    const keyboardSensor = sensors.find(
      (entry) => entry.sensor.name === "KeyboardSensor",
    );

    expect(keyboardSensor?.options).toMatchObject({
      keyboardCodes: {
        start: ["Space"],
        end: ["Space", "Enter"],
        cancel: ["Escape"],
      },
    });
    expect(keyboardSensor?.options).toHaveProperty("coordinateGetter");
  });

  it("gives screen readers localised keyboard instructions and names the card, not its id (VW-13)", async () => {
    await renderBoard();
    const accessibility = (
      drag.callbacks as {
        accessibility: import("@dnd-kit/core").DndContextProps["accessibility"];
      }
    ).accessibility;
    expect(accessibility?.screenReaderInstructions?.draggable).toBe(
      "To pick up an item, press Space. Use the arrow keys to move it, press Space or Enter to drop it, or Escape to cancel.",
    );
    expect(
      accessibility?.announcements?.onDragStart?.({
        active: { id: items[0]?.id ?? "" },
      } as never),
    ).toContain("Title WLP-1");
  });

  it("shows one column per priority, urgent first, with the empty bucket last and counts", async () => {
    await renderBoard();
    const names = columns().map(
      (candidate) => within(candidate).getByRole("heading").textContent,
    );
    expect(names).toEqual(["Urgent", "High", "Medium", "Low", "No priority"]);
    expect(within(column("High")).getByText("Title WLP-1")).toBeInTheDocument();
    expect(
      within(column("No priority")).getByText("Title WLP-3"),
    ).toBeInTheDocument();
    expect(
      within(column("Urgent")).getByText(
        translate("workItems:board.groupEmpty"),
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("work-item-board")).toHaveAttribute(
      "data-group",
      "priority",
    );
  });

  it("shows every assignable person and puts Unassigned last when grouped by assignee", async () => {
    await renderBoard({ field: "assignee" });
    const names = columns().map(
      (candidate) => within(candidate).getByRole("heading").textContent,
    );
    expect(names).toEqual(["Ann", "Bo", "Unassigned"]);
    expect(
      within(column("Ann")).getByRole("group", {
        name: translate("common:a11y.taskContainerLabel", {
          key: "WLP-1",
          title: "Title WLP-1",
        }),
      }),
    ).toBeVisible();
    expect(
      within(column("Ann")).getByRole("group", {
        name: translate("common:a11y.taskContainerLabel", {
          key: "WLP-3",
          title: "Title WLP-3",
        }),
      }),
    ).toBeVisible();
    expect(within(column("Ann")).getAllByRole("group")).toHaveLength(2);
    expect(
      within(column("Unassigned")).getByText("Title WLP-2"),
    ).toBeInTheDocument();
    expect(
      within(column("Bo")).getByText(translate("workItems:board.groupEmpty")),
    ).toBeInTheDocument();
  });

  it("keeps a loaded assignee who is no longer assignable visible as a column", async () => {
    await renderBoard({
      field: "assignee",
      workItems: [
        item("WLP-9", { assigneeId: "p-gone", assigneeName: "Former" }),
      ],
    });
    expect(
      within(column("Former")).getByText("Title WLP-9"),
    ).toBeInTheDocument();
  });

  it("drops onto a priority column by setting the priority with the row's version", async () => {
    const { invalidate } = await renderBoard();
    await drop("WLP-2", "group:priority:urgent");
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-2",
      version: 4,
      priority: "urgent",
    });
    expect(assignWorkItem).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getAllByRole("status").map((node) => node.textContent),
      ).toContain("WLP-2 moved to Urgent."),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "proj_1"],
    });
  });

  it("clears the priority on a drop into the empty bucket", async () => {
    await renderBoard();
    await drop("WLP-1", "group:priority:none");
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      priority: null,
    });
  });

  it("resolves a drop on another card to that card's group", async () => {
    await renderBoard();
    await drop("WLP-2", "id-WLP-1");
    expect(updateWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ key: "WLP-2", priority: "high" }),
    );
  });

  it("does nothing for a drop inside the item's own group", async () => {
    await renderBoard();
    await drop("WLP-1", "group:priority:high");
    await drop("WLP-1", "id-WLP-1");
    expect(updateWorkItem).not.toHaveBeenCalled();
  });

  it("assigns with the current holder as the expected assignee", async () => {
    await renderBoard({ field: "assignee" });
    await drop("WLP-1", "group:assignee:p-bo");
    expect(assignWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      assigneeId: "p-bo",
      expectedCurrentAssigneeId: "p-ann",
    });
    expect(updateWorkItem).not.toHaveBeenCalled();
  });

  it("unassigns with the current holder when dropped on Unassigned", async () => {
    await renderBoard({ field: "assignee" });
    await drop("WLP-1", "group:assignee:none");
    expect(unassignWorkItem).toHaveBeenCalledWith("WLP-1", "p-ann");
  });

  it("refuses a person who is not assignable and writes nothing", async () => {
    await renderBoard({
      field: "assignee",
      workItems: [
        item("WLP-9", { assigneeId: "p-gone", assigneeName: "Former" }),
        item("WLP-8"),
      ],
    });
    await drop("WLP-8", "group:assignee:p-gone");
    expect(assignWorkItem).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "WLP-8 can't be moved to Former.",
    );
  });

  it("does not write a priority change without the set-priority capability", async () => {
    await renderBoard({ canSetPriority: false });
    await drop("WLP-2", "group:priority:urgent");
    expect(updateWorkItem).not.toHaveBeenCalled();
  });

  it("explains a refused assignment when the person lacks the capability", async () => {
    await renderBoard({
      field: "assignee",
      canAssign: false,
      canUnassignAny: false,
    });
    await drop("WLP-1", "group:assignee:p-bo");
    expect(assignWorkItem).not.toHaveBeenCalled();
  });

  it("only lets someone with update clear an assignee who is on the project", async () => {
    await renderBoard({
      field: "assignee",
      canUnassignAny: false,
      canUpdate: true,
    });
    await drop("WLP-1", "group:assignee:none");
    expect(unassignWorkItem).toHaveBeenCalledWith("WLP-1", "p-ann");
    unassignWorkItem.mockClear();
    cleanup();
    await renderBoard({
      field: "assignee",
      canUnassignAny: false,
      canUpdate: false,
    });
    await drop("WLP-1", "group:assignee:none");
    expect(unassignWorkItem).not.toHaveBeenCalled();
  });

  it("reports a version conflict from the server and refreshes", async () => {
    updateWorkItem.mockRejectedValue(new HttpError(409, "conflict"));
    const { invalidate } = await renderBoard();
    await drop("WLP-2", "group:priority:urgent");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "WLP-2 changed in the meantime",
    );
    expect(invalidate).toHaveBeenCalled();
  });

  it("does not start a drag when the person cannot change the grouped field", async () => {
    await renderBoard({ canSetPriority: false });
    await drop("WLP-2", "group:priority:urgent");
    expect(screen.queryByTestId("work-item-drag-overlay-card")).toBeNull();
  });

  it("shows a loading skeleton instead of columns while loading", async () => {
    await renderBoard({ isLoading: true, workItems: undefined });
    expect(screen.getByTestId("work-item-board-loading")).toBeInTheDocument();
  });

  it("shows a retryable error instead of columns when the rows failed to load", async () => {
    const onRetry = vi.fn();
    await renderBoard({ isError: true, workItems: undefined, onRetry });
    expect(screen.queryAllByTestId("work-item-board-column")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the same error when the assignable people fail to load", async () => {
    getAssignablePeople.mockRejectedValue(new HttpError(500, "boom"));
    await renderBoard({ field: "assignee", isLoading: true });
    expect(await screen.findByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("does not fetch the assignable people for a priority grouping", async () => {
    await renderBoard();
    expect(getAssignablePeople).not.toHaveBeenCalled();
  });

  it("shows each assigned label and replaces only the dragged label on drop", async () => {
    const workItems = [
      item("WLP-1", {
        labels: [
          { id: "label-a", name: "Triage", color: "blue" },
          { id: "other", name: "Other", color: "gray" },
        ],
      }),
      item("WLP-2", { labels: [] }),
    ];
    const groups = buildBoardGroups(
      "label",
      workItems,
      [],
      undefined,
      [],
      [
        { id: "label-a", name: "Triage", color: "blue" },
        { id: "label-b", name: "Customer", color: "green" },
      ],
      true,
    );
    await renderBoard({ field: "label", workItems });
    expect(within(column("Triage")).getByText("Title WLP-1")).toBeVisible();
    expect(within(column("Other")).getByText("Title WLP-1")).toBeVisible();
    await drop(
      "WLP-1",
      boardGroupId("label", "label-b"),
      boardGroupItemId(groupWithValue(groups, "label-a"), "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      labelIds: ["other", "label-b"],
    });
  });

  it("adds a label when a no-label card is dropped into a label group", async () => {
    const workItems = [item("WLP-2", { labels: [] })];
    await renderBoard({ field: "label", workItems });
    await drop(
      "WLP-2",
      boardGroupId("label", "label-a"),
      boardGroupItemId(
        {
          id: boardGroupId("label", null),
          field: "label",
          value: null,
          name: null,
          droppable: true,
          items: workItems,
        },
        "id-WLP-2",
      ),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-2",
      version: 4,
      labelIds: ["label-a"],
    });
  });

  it("clears all labels when a card is dropped on None", async () => {
    const workItems = [
      item("WLP-1", {
        labels: [
          { id: "label-a", name: "Triage", color: "blue" },
          { id: "label-b", name: "Customer", color: "green" },
        ],
      }),
    ];
    const groups = buildBoardGroups(
      "label",
      workItems,
      [],
      undefined,
      [],
      [
        { id: "label-a", name: "Triage", color: "blue" },
        { id: "label-b", name: "Customer", color: "green" },
      ],
      true,
    );
    await renderBoard({ field: "label", workItems });
    await drop(
      "WLP-1",
      boardGroupId("label", null),
      boardGroupItemId(groupWithValue(groups, "label-a"), "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      labelIds: [],
    });
  });

  it("replaces only the dragged multi-select value and preserves the others", async () => {
    const customField = {
      key: "impact",
      name: "Impact",
      format: "multi_select" as const,
      options: [
        { key: "low", label: "Low impact" },
        { key: "high", label: "High impact" },
      ],
    };
    const workItems = [
      item("WLP-1", { customFieldValues: { impact: ["low", "high"] } }),
    ];
    const groups = buildBoardGroups("cf.impact", workItems, [], customField);
    await renderBoard({ field: "cf.impact", customField, workItems });
    await drop(
      "WLP-1",
      boardGroupId("cf.impact", "high"),
      boardGroupItemId(groupWithValue(groups, "low"), "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      customFields: { impact: ["high"] },
    });
  });

  it("clears the multi-select array when a card is dropped on None", async () => {
    const customField = {
      key: "impact",
      name: "Impact",
      format: "multi_select" as const,
      options: [{ key: "high", label: "High impact" }],
    };
    const workItems = [
      item("WLP-1", { customFieldValues: { impact: ["high"] } }),
    ];
    const groups = buildBoardGroups("cf.impact", workItems, [], customField);
    await renderBoard({ field: "cf.impact", customField, workItems });
    await drop(
      "WLP-1",
      boardGroupId("cf.impact", null),
      boardGroupItemId(groupWithValue(groups, "high"), "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      customFields: { impact: [] },
    });
  });

  it("moves existing user values through the custom-field update with the version", async () => {
    const customField = {
      key: "reviewer",
      name: "Reviewer",
      format: "user" as const,
      options: [],
    };
    const workItems = [
      item("WLP-1", { customFieldValues: { reviewer: "person-a" } }),
      item("WLP-2", { customFieldValues: { reviewer: "person-b" } }),
    ];
    const groups = buildBoardGroups("cf.reviewer", workItems, [], customField, [
      { projectId: "proj_1", personId: "person-a", name: "Ann" },
      { projectId: "proj_1", personId: "person-b", name: "Bo" },
    ]);
    await renderBoard({
      field: "cf.reviewer",
      customField,
      customFieldPeople: [
        { projectId: "proj_1", personId: "person-a", name: "Ann" },
        { projectId: "proj_1", personId: "person-b", name: "Bo" },
      ],
      workItems,
    });
    await drop(
      "WLP-1",
      boardGroupId("cf.reviewer", "person-b"),
      boardGroupItemId(groupWithValue(groups, "person-a"), "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      customFields: { reviewer: "person-b" },
    });
  });

  it("sets a scalar select field to the selected option using the current version", async () => {
    const customField = {
      key: "impact",
      name: "Impact",
      format: "select" as const,
      options: [
        { key: "low", label: "Low impact" },
        { key: "high", label: "High impact" },
      ],
    };
    const workItems = [
      item("WLP-1", { customFieldValues: { impact: "low" } }),
      item("WLP-2", { customFieldValues: { impact: "high" } }),
    ];
    const groups = buildBoardGroups("cf.impact", workItems, [], customField);
    await renderBoard({ field: "cf.impact", customField, workItems });
    await drop(
      "WLP-1",
      boardGroupId("cf.impact", "high"),
      boardGroupItemId(groupWithValue(groups, "low"), "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      customFields: { impact: "high" },
    });
  });

  it("clears a scalar custom field to null on the empty group", async () => {
    const customField = {
      key: "impact",
      name: "Impact",
      format: "select" as const,
      options: [{ key: "high", label: "High impact" }],
    };
    const workItems = [
      item("WLP-1", { customFieldValues: { impact: "high" } }),
    ];
    const groups = buildBoardGroups("cf.impact", workItems, [], customField);
    await renderBoard({ field: "cf.impact", customField, workItems });
    await drop(
      "WLP-1",
      boardGroupId("cf.impact", null),
      boardGroupItemId(groupWithValue(groups, "high"), "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      customFields: { impact: null },
    });
  });

  it("moves a currency field by its full amount-and-currency value", async () => {
    const customField = {
      key: "estimate",
      name: "Estimate",
      format: "currency" as const,
      options: [],
    };
    const workItems = [
      item("WLP-1", {
        customFieldValues: { estimate: { amount: 125, currency: "USD" } },
      }),
      item("WLP-2", {
        customFieldValues: { estimate: { amount: 50, currency: "EUR" } },
      }),
    ];
    const groups = buildBoardGroups("cf.estimate", workItems, [], customField);
    const usdGroup = groups.find(
      (group) =>
        typeof group.value === "object" && group.value?.currency === "USD",
    );
    if (!usdGroup) throw new Error("Missing USD group");
    await renderBoard({ field: "cf.estimate", customField, workItems });
    await drop(
      "WLP-1",
      boardGroupId("cf.estimate", { amount: 50, currency: "EUR" }),
      boardGroupItemId(usdGroup, "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      customFields: { estimate: { amount: 50, currency: "EUR" } },
    });
  });

  it("moves only the dragged member of a multi-user field", async () => {
    const customField = {
      key: "reviewers",
      name: "Reviewers",
      format: "multi_user" as const,
      options: [],
    };
    const workItems = [
      item("WLP-1", {
        customFieldValues: { reviewers: ["person-a", "person-b"] },
      }),
    ];
    const customFieldPeople = [
      { projectId: "proj_1", personId: "person-a", name: "Ann" },
      { projectId: "proj_1", personId: "person-b", name: "Bo" },
    ];
    const groups = buildBoardGroups(
      "cf.reviewers",
      workItems,
      [],
      customField,
      customFieldPeople,
    );
    await renderBoard({
      field: "cf.reviewers",
      customField,
      customFieldPeople,
      workItems,
    });
    await drop(
      "WLP-1",
      boardGroupId("cf.reviewers", "person-b"),
      boardGroupItemId(groupWithValue(groups, "person-a"), "id-WLP-1"),
    );
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 4,
      customFields: { reviewers: ["person-b"] },
    });
  });

  it("waits for capabilities before fetching the assignable people", async () => {
    await renderBoard({
      field: "assignee",
      peopleEnabled: false,
      isLoading: true,
    });
    expect(getAssignablePeople).not.toHaveBeenCalled();
  });
});
