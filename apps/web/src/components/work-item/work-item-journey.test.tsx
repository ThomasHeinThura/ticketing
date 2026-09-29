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

const permissionFlags = vi.hoisted(() => ({
  update: true,
  assign: true,
  publicComments: false,
  internalComments: false,
}));
const authState = vi.hoisted(() => ({ userId: "user-1" }));
const activityFetcher = vi.hoisted(() => vi.fn());
const updateWorkItem = vi.fn();
const assignWorkItem = vi.fn();
const unassignWorkItem = vi.fn();
const getAssignablePeople = vi.fn();
const createWorkItemComment = vi.fn();
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
vi.mock("@/fetchers/work-item/create-work-item-comment", () => ({
  default: (...args: unknown[]) => createWorkItemComment(...args),
}));
vi.mock("@/components/activity/comment-editor", () => ({
  default: (props: {
    ariaLabel: string;
    value: string;
    onChange: (value: string) => void;
    onDocumentChange: (value: unknown) => void;
  }) => (
    <textarea
      aria-label={props.ariaLabel}
      value={props.value}
      onChange={(event) => {
        const value = event.target.value;
        props.onChange(value);
        props.onDocumentChange({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: value ? [{ type: "text", text: value }] : [],
            },
          ],
        });
      }}
    />
  ),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: authState.userId } }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => permissionFlags.update,
    canAssignTasks: () => permissionFlags.assign,
    canCreatePublicComments: () => permissionFlags.publicComments,
    canCreateInternalComments: () => permissionFlags.internalComments,
    isCheckingPermissions: false,
  }),
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  window.localStorage.clear();
  authState.userId = "user-1";
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
  permissionFlags.publicComments = false;
  permissionFlags.internalComments = false;
  createWorkItemComment.mockReset();
  createWorkItemComment.mockResolvedValue({});
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
  it("uses the configured project visibility as the fresh comment default", async () => {
    permissionFlags.publicComments = true;
    permissionFlags.internalComments = true;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <WorkItemJourney
          item={makeItem()}
          onSaved={vi.fn()}
          defaultCommentVisibility="public"
        />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("combobox", { name: /commentVisibility/ }),
    ).toHaveTextContent("public");
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "workItems:journey.commentEditor",
      }),
      { target: { value: "Public by default" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.commentSend" }),
    );

    await waitFor(() =>
      expect(createWorkItemComment).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "WLP-1",
          visibility: "public",
        }),
      ),
    );
  });

  it("restores each user's per-work-item comment draft after the journey remounts", async () => {
    permissionFlags.publicComments = true;
    permissionFlags.internalComments = true;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderJourney = () => (
      <QueryClientProvider client={client}>
        <WorkItemJourney item={makeItem()} onSaved={vi.fn()} />
      </QueryClientProvider>
    );
    const firstMount = render(renderJourney());

    fireEvent.change(
      screen.getByRole("textbox", {
        name: "workItems:journey.commentEditor",
      }),
      { target: { value: "Saved comment draft" } },
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: /commentVisibility/ }),
    );
    const publicOption = screen.getByRole("option", {
      name: "workItems:journey.public",
    });
    fireEvent.pointerDown(publicOption);
    fireEvent.pointerUp(publicOption);
    fireEvent.click(publicOption);
    await waitFor(() => {
      expect(
        window.localStorage.getItem(
          "taskdesk:work-item-comment-draft:v1:user-1:WLP-1",
        ),
      ).toContain('"visibility":"public"');
    });
    firstMount.unmount();

    const secondMount = render(renderJourney());
    expect(
      screen.getByRole("textbox", {
        name: "workItems:journey.commentEditor",
      }),
    ).toHaveValue("Saved comment draft");
    expect(
      screen.getByRole("combobox", { name: /commentVisibility/ }),
    ).toHaveTextContent("public");

    secondMount.unmount();
    authState.userId = "user-2";
    render(renderJourney());
    expect(
      screen.getByRole("textbox", {
        name: "workItems:journey.commentEditor",
      }),
    ).toHaveValue("");
  });

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

  it("resets edit and assignment drafts when the mounted journey changes work items", async () => {
    updateWorkItem.mockResolvedValue({});
    const first = makeItem();
    first.assigneeId = "person-a";
    const second = {
      ...makeItem(),
      id: "wi_2",
      key: "WLP-2",
      title: "Second item",
      version: 12,
      assigneeId: "person-b",
    };
    getAssignablePeople.mockResolvedValue([
      { personId: "person-a", name: "Person A", roleName: "Member" },
      { personId: "person-b", name: "Person B", roleName: "Member" },
      { personId: "person-c", name: "Person C", roleName: "Member" },
    ]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={first} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.edit" }),
    );
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "Draft for first item" },
    });
    const firstAssignee = await screen.findByRole("combobox", {
      name: "workItems:journey.assignee",
    });
    fireEvent.click(firstAssignee);
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Person C · Member",
      }),
    );
    view.rerender(
      <QueryClientProvider client={client}>
        <WorkItemJourney item={second} onSaved={vi.fn()} />
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "workItems:journey.edit" }),
    );
    expect(screen.getByLabelText("workItems:journey.title")).toHaveValue(
      "Second item",
    );
    expect(screen.queryByDisplayValue("Draft for first item")).toBeNull();
    const secondAssignee = screen.getByRole("combobox", {
      name: "workItems:journey.assignee",
    });
    expect(secondAssignee).toHaveTextContent("person-b");
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "Second item edited" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    await waitFor(() =>
      expect(updateWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "WLP-2",
          version: 12,
          title: "Second item edited",
        }),
      ),
    );
  });

  it("filters activity and only shows a composer for allowed comment visibility", async () => {
    permissionFlags.update = false;
    permissionFlags.assign = false;
    permissionFlags.internalComments = true;
    const publicActivity = {
      id: "public-change",
      kind: "activity",
      verb: "updated",
      field: "title",
      visibility: "public",
      createdAt: "2026-09-29T10:00:00.000Z",
    };
    const internalComment = {
      id: "internal-note",
      kind: "comment",
      verb: "commented",
      visibility: "internal",
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Staff-only note" }],
          },
        ],
      },
      createdAt: "2026-09-29T09:00:00.000Z",
    };
    activityFetcher.mockResolvedValue({
      data: [publicActivity, internalComment],
      page: { hasMore: false, nextCursor: null },
    });
    const onActivityFilterChange = vi.fn();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = render(
      <QueryClientProvider client={client}>
        <WorkItemJourney
          item={makeItem()}
          activityFilter="comments"
          onActivityFilterChange={onActivityFilterChange}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Staff-only note")).toBeInTheDocument();
    expect(screen.queryByText("title: — → —")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "workItems:journey.filterComments" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.filterPublic" }),
    );
    expect(onActivityFilterChange).toHaveBeenCalledWith("public");

    view.rerender(
      <QueryClientProvider client={client}>
        <WorkItemJourney
          item={makeItem()}
          activityFilter="public"
          onActivityFilterChange={onActivityFilterChange}
          onSaved={vi.fn()}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("title: — → —")).toBeInTheDocument();
    expect(screen.queryByText("Staff-only note")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "workItems:journey.commentVisibility: workItems:journey.internal",
      ),
    ).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "workItems:journey.commentEditor",
      }),
      { target: { value: "Staff-only draft" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.commentSend" }),
    );
    await waitFor(() =>
      expect(createWorkItemComment).toHaveBeenCalledWith({
        key: "WLP-1",
        body: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Staff-only draft" }],
            },
          ],
        },
        visibility: "internal",
      }),
    );
    await waitFor(() => {
      expect(
        window.localStorage.getItem(
          "taskdesk:work-item-comment-draft:v1:user-1:WLP-1",
        ),
      ).toBeNull();
    });
  });
});
