import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemJourney from "./work-item-journey";

const permissionFlags = vi.hoisted(() => ({ update: true, assign: true }));
const activityFetcher = vi.hoisted(() => vi.fn());
const updateWorkItem = vi.fn();
const assignWorkItem = vi.fn();
const unassignWorkItem = vi.fn();
const getAssignablePeople = vi.fn();
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: (...args: unknown[]) => updateWorkItem(...args),
}));
vi.mock("@/fetchers/work-item/get-work-item-activity", () => ({
  default: (...args: unknown[]) => activityFetcher(...args),
}));
vi.mock("@/fetchers/work-item/get-assignable-people", () => ({
  default: (...args: unknown[]) => getAssignablePeople(...args),
}));
vi.mock("@/fetchers/work-item/assign-work-item", () => ({
  default: (...args: unknown[]) => assignWorkItem(...args),
}));
vi.mock("@/fetchers/work-item/unassign-work-item", () => ({
  default: (...args: unknown[]) => unassignWorkItem(...args),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => permissionFlags.update,
    canAssignTasks: () => permissionFlags.assign,
    isCheckingPermissions: false,
  }),
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  updateWorkItem.mockReset();
  assignWorkItem.mockReset();
  assignWorkItem.mockResolvedValue({});
  unassignWorkItem.mockReset();
  unassignWorkItem.mockResolvedValue({});
  activityFetcher.mockReset();
  activityFetcher.mockResolvedValue({
    data: [],
    page: { hasMore: false, nextCursor: null },
  });
  getAssignablePeople.mockReset();
  getAssignablePeople.mockResolvedValue([]);
  permissionFlags.update = true;
  permissionFlags.assign = true;
});

function makeItem(): WorkItemDetailRow {
  return {
    id: "wi_1",
    projectId: "proj_1",
    workspaceId: "ws_1",
    typeId: "type_1",
    number: 1,
    key: "WLP-1",
    title: "Before",
    description: "Notes",
    stateId: "state_1",
    stateName: "Backlog",
    stateCategory: "backlog",
    priority: null,
    assigneeId: null,
    assigneeName: null,
    requesterId: null,
    parentId: null,
    position: "1",
    customerVisibility: "private",
    startDate: null,
    dueDate: null,
    archivedAt: null,
    deletedAt: null,
    version: 7,
    createdAt: "2026-09-29T09:00:00.000Z",
    updatedAt: "2026-09-29T09:00:00.000Z",
    unavailableFields: [],
  } as WorkItemDetailRow;
}

describe("WorkItemJourney", () => {
  it("keeps the edit draft visible after a 409 and does not silently retry with the newer version", async () => {
    updateWorkItem.mockRejectedValue(new WorkItemVersionConflictError(7, 8));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={makeItem()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.edit" }),
    );
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "My draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "workItems:journey.editConflict",
      ),
    );
    expect(screen.getByLabelText("workItems:journey.title")).toHaveValue(
      "My draft",
    );
    expect(updateWorkItem).toHaveBeenCalledTimes(1);
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 7,
      title: "My draft",
      description: "Notes",
      startDate: null,
      dueDate: null,
    });
  });

  it("sends populated calendar date inputs in the API's UTC ISO date-time format", async () => {
    updateWorkItem.mockResolvedValue({});
    const item = makeItem();
    item.startDate = "2026-09-20T00:00:00.000Z";
    item.dueDate = "2026-10-10T00:00:00.000Z";
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={item} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.edit" }),
    );
    expect(screen.getByLabelText("workItems:journey.startDate")).toHaveValue(
      "2026-09-20",
    );
    expect(screen.getByLabelText("workItems:journey.dueDate")).toHaveValue(
      "2026-10-10",
    );
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "Updated title" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );

    await waitFor(() => expect(updateWorkItem).toHaveBeenCalledTimes(1));
    expect(updateWorkItem).toHaveBeenCalledWith({
      key: "WLP-1",
      version: 7,
      title: "Updated title",
      description: "Notes",
      startDate: "2026-09-20T00:00:00.000Z",
      dueDate: "2026-10-10T00:00:00.000Z",
    });
  });

  it("hides edit and assignment controls when the capability response grants neither", async () => {
    permissionFlags.update = false;
    permissionFlags.assign = false;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={makeItem()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("heading", {
          name: "workItems:journey.activityHeading",
        }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "workItems:journey.edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", {
        name: "workItems:journey.assignmentHeading",
      }),
    ).not.toBeInTheDocument();
    expect(getAssignablePeople).not.toHaveBeenCalled();
  });

  it("shows only self-assignment for update-only callers and loads older rich-text activity", async () => {
    permissionFlags.assign = false;
    getAssignablePeople.mockResolvedValue([
      { personId: "self", name: "Current Agent", roleName: "Member" },
    ]);
    assignWorkItem.mockRejectedValue(new Error("Expected isolated test"));
    const row = (id: string, text: string, createdAt: string) => ({
      id,
      kind: "comment",
      verb: "commented",
      createdAt,
      visibility: "internal",
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text, marks: [{ type: "bold" }] }],
          },
        ],
      },
    });
    activityFetcher
      .mockResolvedValueOnce({
        data: [row("new", "Newer comment", "2026-09-29T10:00:00.000Z")],
        page: { hasMore: true, nextCursor: "older-cursor" },
      })
      .mockResolvedValueOnce({
        data: [row("old", "Older comment", "2026-09-29T09:00:00.000Z")],
        page: { hasMore: false, nextCursor: null },
      });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={makeItem()} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    const selfAssign = await screen.findByRole("button", {
      name: "workItems:journey.assignToMe",
    });
    expect(
      screen.queryByRole("combobox", { name: "workItems:journey.assignee" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("Newer comment")).toBeInTheDocument();
    expect(screen.getByText("Newer comment").tagName).toBe("STRONG");
    fireEvent.click(selfAssign);
    await waitFor(() =>
      expect(assignWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        assigneeId: "self",
        expectedCurrentAssigneeId: null,
      }),
    );
    const loadOlder = await screen.findByRole("button", {
      name: "workItems:journey.loadOlderActivity",
    });
    fireEvent.click(loadOlder);
    expect(await screen.findByText("Older comment")).toBeInTheDocument();
    expect(activityFetcher).toHaveBeenLastCalledWith("WLP-1", "older-cursor");
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Older comment");
    expect(rows[1]).toHaveTextContent("Newer comment");
  });

  it("lets update-only callers unassign themselves but not a colleague", async () => {
    permissionFlags.assign = false;
    getAssignablePeople.mockResolvedValue([
      { personId: "self", name: "Current Agent", roleName: "Member" },
    ]);
    const ownAssignment = makeItem();
    ownAssignment.assigneeId = "self";
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={ownAssignment} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "workItems:journey.unassign" }),
    );
    await waitFor(() => expect(unassignWorkItem).toHaveBeenCalledWith("WLP-1"));

    view.unmount();
    const colleagueAssignment = makeItem();
    colleagueAssignment.assigneeId = "colleague";
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <WorkItemJourney item={colleagueAssignment} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "workItems:journey.assignToMe" });
    expect(
      screen.queryByRole("button", { name: "workItems:journey.unassign" }),
    ).not.toBeInTheDocument();
  });

  it("lets assign-capable callers unassign another person", async () => {
    const item = makeItem();
    item.assigneeId = "colleague";
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={item} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "workItems:journey.unassign" }),
    );
    await waitFor(() => expect(unassignWorkItem).toHaveBeenCalledWith("WLP-1"));
  });
});
