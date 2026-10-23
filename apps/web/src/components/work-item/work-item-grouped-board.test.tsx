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
import { translate } from "@/test/en-translation";
import type { WorkItemRow } from "@/types/work-item";
import WorkItemGroupedBoard from "./work-item-grouped-board";

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
vi.mock("@/fetchers/work-item/get-assignable-people", () => ({
  default: (...args: unknown[]) => getAssignablePeople(...args),
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

const items = [
  item("WLP-1", { priority: "high", assigneeId: "p-ann", assigneeName: "Ann" }),
  item("WLP-2", { priority: "low" }),
  item("WLP-3", { priority: null, assigneeId: "p-ann", assigneeName: "Ann" }),
];
const people = [
  { personId: "p-ann", name: "Ann" },
  { personId: "p-bo", name: "Bo" },
];

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
async function drop(itemKey: string, overId: string) {
  const handlers = drag.callbacks as {
    onDragStart: (event: unknown) => void;
    onDragEnd: (event: unknown) => Promise<void>;
  };
  act(() => {
    handlers.onDragStart({
      active: { id: `id-${itemKey}` },
      activatorEvent: new MouseEvent("mousedown"),
    });
  });
  await act(async () => {
    await handlers.onDragEnd({
      active: { id: `id-${itemKey}` },
      over: { id: overId },
    });
  });
}

beforeEach(() => {
  updateWorkItem.mockReset().mockResolvedValue({});
  getAssignablePeople.mockReset().mockResolvedValue(people);
  assignWorkItem.mockReset().mockResolvedValue({});
  unassignWorkItem.mockReset().mockResolvedValue({});
});
afterEach(cleanup);

describe("WorkItemGroupedBoard (VW-13)", () => {
  it("gives screen readers localised keyboard instructions and names the card, not its id (VW-13)", async () => {
    await renderBoard();
    const accessibility = (
      drag.callbacks as {
        accessibility: import("@dnd-kit/core").DndContextProps["accessibility"];
      }
    ).accessibility;
    expect(accessibility?.screenReaderInstructions?.draggable).toMatch(
      /press space or enter/i,
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
      within(column("Urgent")).getByText("No work items in this group."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("work-item-board")).toHaveAttribute(
      "data-group",
      "priority",
    );
  });

  it("shows Unassigned first and every assignable person as a column when grouped by assignee", async () => {
    await renderBoard({ field: "assignee" });
    const names = columns().map(
      (candidate) => within(candidate).getByRole("heading").textContent,
    );
    expect(names).toEqual(["Unassigned", "Ann", "Bo"]);
    expect(within(column("Ann")).getAllByText(/Title WLP-[13]/)).toHaveLength(
      2,
    );
    expect(
      within(column("Unassigned")).getByText("Title WLP-2"),
    ).toBeInTheDocument();
    expect(
      within(column("Bo")).getByText("No work items in this group."),
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

  it("waits for capabilities before fetching the assignable people", async () => {
    await renderBoard({
      field: "assignee",
      peopleEnabled: false,
      isLoading: true,
    });
    expect(getAssignablePeople).not.toHaveBeenCalled();
  });
});
