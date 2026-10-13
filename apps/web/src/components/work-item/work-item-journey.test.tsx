import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemJourney from "./work-item-journey";

const permissionFlags = vi.hoisted(() => ({
  update: true,
  transition: false,
  assign: true,
  checking: false,
}));
const transitionsFetcher = vi.hoisted(() => vi.fn());
const updateWorkItem = vi.fn();
const transitionWorkItem = vi.fn();
const assignWorkItem = vi.fn();
const unassignWorkItem = vi.fn();
const getAssignablePeople = vi.fn();
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: (...args: unknown[]) => updateWorkItem(...args),
}));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: (...args: unknown[]) => transitionsFetcher(...args),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: (...args: unknown[]) => transitionWorkItem(...args),
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
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
// Every capability is read for the item's own workspace (target-scoped), never the
// active one; the stub records what it was asked for.
const permissionScopes = vi.hoisted(() => [] as Array<string | undefined>);
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (workspaceId?: string) => {
    permissionScopes.push(workspaceId);
    return {
      canUpdateTasks: () => permissionFlags.update,
      canAssignTasks: () => permissionFlags.assign,
      canTransitionTasks: () => permissionFlags.transition,
      isCheckingPermissions: permissionFlags.checking,
    };
  },
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  permissionScopes.length = 0;
  updateWorkItem.mockReset();
  transitionWorkItem.mockReset();
  transitionWorkItem.mockResolvedValue({});
  assignWorkItem.mockReset();
  assignWorkItem.mockResolvedValue({});
  unassignWorkItem.mockReset();
  unassignWorkItem.mockResolvedValue({});
  transitionsFetcher.mockReset();
  transitionsFetcher.mockResolvedValue([]);
  getAssignablePeople.mockReset();
  getAssignablePeople.mockResolvedValue([]);
  permissionFlags.update = true;
  permissionFlags.transition = false;
  permissionFlags.assign = true;
  permissionFlags.checking = false;
});

function makeItem(overrides: Partial<WorkItemDetailRow> = {}) {
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
    ...overrides,
  } as WorkItemDetailRow;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(client: QueryClient, children: ReactNode) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const offer = (overrides: Record<string, unknown> = {}) => ({
  transitionId: "resolve",
  toStateTemplateId: "done-template",
  toStateName: "Done",
  toStateId: "done-state",
  notePolicy: "required",
  noteVisibility: "public",
  requiresApproval: false,
  requiresCab: false,
  isReopen: false,
  available: false,
  blockedBy: [{ kind: "note", reasonCode: "note.required" }],
  ...overrides,
});

/** Base UI selects an option on the real pointer sequence, not on a bare click. */
function pickOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

function openEdit() {
  fireEvent.click(
    screen.getByRole("button", { name: "workItems:journey.edit" }),
  );
}

describe("WorkItemJourney edit (WI-7, WI-8)", () => {
  it("keeps the edit draft visible after a 409 and does not silently retry with the newer version", async () => {
    updateWorkItem.mockRejectedValue(new WorkItemVersionConflictError(7, 8));
    const client = newClient();
    const view = render(
      wrap(
        client,
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );

    openEdit();
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

    // The refreshed server row arrives; the draft is NOT replaced by it.
    view.rerender(
      wrap(
        client,
        <WorkItemJourney
          item={makeItem({ title: "Server update", version: 8 })}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    expect(screen.getByLabelText("workItems:journey.title")).toHaveValue(
      "My draft",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );

    // A second explicit save still asserts the version the draft was based on: the
    // newer version is never adopted behind the user's back.
    await waitFor(() => expect(updateWorkItem).toHaveBeenCalledTimes(2));
    expect(updateWorkItem.mock.calls[1]?.[0]).toMatchObject({
      version: 7,
      title: "My draft",
    });
  });

  it("only re-bases the draft on the latest version when the user explicitly reloads", async () => {
    updateWorkItem.mockRejectedValueOnce(
      new WorkItemVersionConflictError(7, 8),
    );
    const client = newClient();
    const view = render(
      wrap(
        client,
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    openEdit();
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "My draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    await screen.findByRole("button", {
      name: "workItems:journey.reloadLatest",
    });
    view.rerender(
      wrap(
        client,
        <WorkItemJourney
          item={makeItem({ title: "Server update", version: 8 })}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.reloadLatest" }),
    );
    expect(screen.getByLabelText("workItems:journey.title")).toHaveValue(
      "Server update",
    );
    updateWorkItem.mockResolvedValue({});
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    await waitFor(() =>
      expect(updateWorkItem).toHaveBeenLastCalledWith(
        expect.objectContaining({ version: 8, title: "Server update" }),
      ),
    );
  });

  it("sends populated calendar date inputs in the API's UTC ISO date-time format", async () => {
    updateWorkItem.mockResolvedValue({});
    render(
      wrap(
        newClient(),
        <WorkItemJourney
          item={makeItem({
            startDate: "2026-09-20T00:00:00.000Z",
            dueDate: "2026-10-10T00:00:00.000Z",
          })}
          onAccessLost={vi.fn()}
        />,
      ),
    );

    openEdit();
    expect(screen.getByLabelText("workItems:journey.startDate")).toHaveValue(
      "2026-09-20",
    );
    expect(screen.getByLabelText("workItems:journey.dueDate")).toHaveValue(
      "2026-10-10",
    );
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "Updated title" },
    });
    fireEvent.change(screen.getByLabelText("workItems:journey.dueDate"), {
      target: { value: "2026-12-31" },
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
      dueDate: "2026-12-31T00:00:00.000Z",
    });
  });

  it("clears a date by sending null, and a changed description by its text", async () => {
    updateWorkItem.mockResolvedValue({});
    render(
      wrap(
        newClient(),
        <WorkItemJourney
          item={makeItem({ dueDate: "2026-10-10T00:00:00.000Z" })}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    openEdit();
    fireEvent.change(screen.getByLabelText("workItems:journey.dueDate"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("workItems:journey.description"), {
      target: { value: "New notes" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    await waitFor(() =>
      expect(updateWorkItem).toHaveBeenCalledWith(
        expect.objectContaining({ dueDate: null, description: "New notes" }),
      ),
    );
  });

  it("closes the form and refreshes the detail after a successful save", async () => {
    updateWorkItem.mockResolvedValue({});
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      wrap(
        client,
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    openEdit();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText("workItems:journey.title"),
      ).not.toBeInTheDocument(),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "detail", "WLP-1"],
    });
  });

  it("does not offer editing when a round-tripped field failed to load", () => {
    render(
      wrap(
        newClient(),
        <WorkItemJourney
          item={makeItem({ unavailableFields: ["dueDate"] })}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    expect(
      screen.queryByRole("button", { name: "workItems:journey.edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("workItems:journey.editUnavailable"),
    ).toBeInTheDocument();
  });

  it("moves focus into the form on open and back to its trigger on cancel", async () => {
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    openEdit();
    await waitFor(() =>
      expect(screen.getByLabelText("workItems:journey.title")).toHaveFocus(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.cancel" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "workItems:journey.edit" }),
      ).toHaveFocus(),
    );
  });
});

describe("WorkItemJourney capability gating", () => {
  it("hides edit, assignment and state controls and fetches nothing when the capability response grants none", async () => {
    permissionFlags.update = false;
    permissionFlags.assign = false;
    permissionFlags.transition = false;
    const { container } = render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
    expect(getAssignablePeople).not.toHaveBeenCalled();
    expect(transitionsFetcher).not.toHaveBeenCalled();
  });

  it("does not fetch or render state transitions without the strict transition capability, even for an updater", async () => {
    permissionFlags.update = true;
    permissionFlags.transition = false;
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    await screen.findByRole("heading", {
      name: "workItems:journey.assignmentHeading",
    });
    expect(transitionsFetcher).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("combobox", { name: "workItems:detail.stateLabel" }),
    ).not.toBeInTheDocument();
  });

  it("renders nothing while permissions are still being checked", () => {
    permissionFlags.checking = true;
    permissionFlags.transition = true;
    const { container } = render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    expect(container).toBeEmptyDOMElement();
    expect(transitionsFetcher).not.toHaveBeenCalled();
  });

  it("reads capabilities for the item's own workspace", () => {
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    expect(permissionScopes.length).toBeGreaterThan(0);
    expect(new Set(permissionScopes)).toEqual(new Set(["ws_1"]));
  });
});

describe("WorkItemJourney assignment (AS-1, AS-2, AS-3, AS-9)", () => {
  it("shows only self-assignment for update-only callers", async () => {
    permissionFlags.assign = false;
    getAssignablePeople.mockResolvedValue([
      { personId: "self", name: "Current Agent", roleName: "Member" },
    ]);
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );

    const selfAssign = await screen.findByRole("button", {
      name: "workItems:journey.assignToMe",
    });
    expect(
      screen.queryByRole("combobox", { name: "workItems:journey.assignee" }),
    ).not.toBeInTheDocument();
    fireEvent.click(selfAssign);
    await waitFor(() =>
      expect(assignWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        assigneeId: "self",
        expectedCurrentAssigneeId: null,
      }),
    );
  });

  it("lets update-only callers unassign themselves but not a colleague", async () => {
    permissionFlags.assign = false;
    getAssignablePeople.mockResolvedValue([
      { personId: "self", name: "Current Agent", roleName: "Member" },
    ]);
    const view = render(
      wrap(
        newClient(),
        <WorkItemJourney
          item={makeItem({ assigneeId: "self" })}
          onAccessLost={vi.fn()}
        />,
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "workItems:journey.unassign" }),
    );
    await waitFor(() => expect(unassignWorkItem).toHaveBeenCalledWith("WLP-1"));

    view.unmount();
    render(
      wrap(
        newClient(),
        <WorkItemJourney
          item={makeItem({ assigneeId: "colleague" })}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    await screen.findByRole("button", { name: "workItems:journey.assignToMe" });
    expect(
      screen.queryByRole("button", { name: "workItems:journey.unassign" }),
    ).not.toBeInTheDocument();
  });

  it("lets assign-capable callers unassign another person", async () => {
    render(
      wrap(
        newClient(),
        <WorkItemJourney
          item={makeItem({ assigneeId: "colleague" })}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "workItems:journey.unassign" }),
    );
    await waitFor(() => expect(unassignWorkItem).toHaveBeenCalledWith("WLP-1"));
  });

  it("asks for confirmation before taking work held by someone else, then asserts the holder it saw", async () => {
    getAssignablePeople.mockResolvedValue([
      { personId: "person-a", name: "Person A", roleName: "Member" },
      { personId: "person-b", name: "Person B", roleName: "Member" },
    ]);
    render(
      wrap(
        newClient(),
        <WorkItemJourney
          item={makeItem({ assigneeId: "person-a" })}
          onAccessLost={vi.fn()}
        />,
      ),
    );
    fireEvent.click(
      await screen.findByRole("combobox", {
        name: "workItems:journey.assignee",
      }),
    );
    pickOption(
      await screen.findByRole("option", { name: "Person B · Member" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.assign" }),
    );
    expect(
      screen.getByText("workItems:journey.confirmReassign"),
    ).toBeInTheDocument();
    expect(assignWorkItem).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:journey.confirmAssignment",
      }),
    );
    await waitFor(() =>
      expect(assignWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        assigneeId: "person-b",
        expectedCurrentAssigneeId: "person-a",
      }),
    );
  });

  it("shows the conflict message and refreshes the item on a 409", async () => {
    assignWorkItem.mockRejectedValue(new HttpError(409, "conflict"));
    getAssignablePeople.mockResolvedValue([
      { personId: "self", name: "Current Agent", roleName: "Member" },
    ]);
    permissionFlags.assign = false;
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      wrap(
        client,
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "workItems:journey.assignToMe",
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workItems:journey.assignmentConflict",
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-items", "detail", "WLP-1"],
    });
  });

  it("shows a retryable error when the assignable people fail to load", async () => {
    getAssignablePeople.mockRejectedValueOnce(new HttpError(500, "boom"));
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workItems:journey.peopleError",
    );
    getAssignablePeople.mockResolvedValue([
      { personId: "p", name: "P", roleName: "Member" },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:detail.retry" }),
    );
    expect(
      await screen.findByRole("combobox", {
        name: "workItems:journey.assignee",
      }),
    ).toBeInTheDocument();
  });
});

describe("WorkItemJourney item change", () => {
  it("resets edit and assignment drafts when the mounted journey changes work items", async () => {
    updateWorkItem.mockResolvedValue({});
    getAssignablePeople.mockResolvedValue([
      { personId: "person-a", name: "Person A", roleName: "Member" },
      { personId: "person-b", name: "Person B", roleName: "Member" },
      { personId: "person-c", name: "Person C", roleName: "Member" },
    ]);
    const client = newClient();
    const view = render(
      wrap(
        client,
        <WorkItemJourney
          item={makeItem({ assigneeId: "person-a" })}
          onAccessLost={vi.fn()}
        />,
      ),
    );

    openEdit();
    fireEvent.change(screen.getByLabelText("workItems:journey.title"), {
      target: { value: "Draft for first item" },
    });
    fireEvent.click(
      await screen.findByRole("combobox", {
        name: "workItems:journey.assignee",
      }),
    );
    pickOption(
      await screen.findByRole("option", { name: "Person C · Member" }),
    );
    view.rerender(
      wrap(
        client,
        <WorkItemJourney
          item={makeItem({
            id: "wi_2",
            key: "WLP-2",
            title: "Second item",
            version: 12,
            assigneeId: "person-b",
          })}
          onAccessLost={vi.fn()}
        />,
      ),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "workItems:journey.edit" }),
    );
    expect(screen.getByLabelText("workItems:journey.title")).toHaveValue(
      "Second item",
    );
    expect(screen.queryByDisplayValue("Draft for first item")).toBeNull();
    expect(
      await screen.findByRole("combobox", {
        name: "workItems:journey.assignee",
      }),
    ).toHaveTextContent("Person B");
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
});

describe("WorkItemJourney state change (WI-9, workflows)", () => {
  async function renderWithOffers(offers: unknown[]) {
    permissionFlags.transition = true;
    transitionsFetcher.mockResolvedValue(offers);
    const client = newClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(
      wrap(
        client,
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    return { client, invalidate };
  }

  it("shows server-offered state transitions and requires the requested note", async () => {
    const { invalidate } = await renderWithOffers([
      offer(),
      offer({
        transitionId: "blocked",
        toStateTemplateId: "blocked-template",
        toStateName: "Blocked state",
        notePolicy: "none",
        blockedBy: [{ kind: "guard", reasonCode: "guard.assignee_present" }],
      }),
    ]);

    fireEvent.click(
      await screen.findByRole("combobox", {
        name: "workItems:detail.stateLabel",
      }),
    );
    expect(
      await screen.findByRole("option", { name: /Blocked state/ }),
    ).toHaveAttribute("aria-disabled", "true");
    pickOption(await screen.findByRole("option", { name: /Done/ }));
    expect(
      screen.getByRole("combobox", { name: "workItems:detail.stateLabel" }),
    ).toHaveTextContent("Done");
    const submit = screen.getByRole("button", {
      name: "workItems:journey.save",
    });
    expect(submit).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("workItems:journey.transitionNote"),
      { target: { value: "Resolution verified" } },
    );
    fireEvent.click(submit);
    await waitFor(() =>
      expect(transitionWorkItem).toHaveBeenCalledWith({
        key: "WLP-1",
        toStateTemplateId: "done-template",
        note: "Resolution verified",
      }),
    );
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["work-items", "detail", "WLP-1"],
      }),
    );
  });

  it("does not run an offer blocked for a reason other than the note", async () => {
    await renderWithOffers([
      offer({
        notePolicy: "none",
        blockedBy: [{ kind: "guard", reasonCode: "guard.assignee_present" }],
      }),
    ]);
    fireEvent.click(
      await screen.findByRole("combobox", {
        name: "workItems:detail.stateLabel",
      }),
    );
    expect(await screen.findByRole("option", { name: /Done/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("shows the server's current offers and a message when the state changed under the user (409)", async () => {
    await renderWithOffers([
      offer({ notePolicy: "none", available: true, blockedBy: [] }),
    ]);
    transitionWorkItem.mockRejectedValue(new HttpError(409, "conflict"));
    fireEvent.click(
      await screen.findByRole("combobox", {
        name: "workItems:detail.stateLabel",
      }),
    );
    pickOption(await screen.findByRole("option", { name: /Done/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workItems:journey.transitionConflict",
    );
    await waitFor(() => expect(transitionsFetcher).toHaveBeenCalledTimes(2));
  });

  it("explains a 422 (legal but not currently available)", async () => {
    await renderWithOffers([
      offer({ notePolicy: "none", available: true, blockedBy: [] }),
    ]);
    transitionWorkItem.mockRejectedValue(new HttpError(422, "blocked"));
    fireEvent.click(
      await screen.findByRole("combobox", {
        name: "workItems:detail.stateLabel",
      }),
    );
    pickOption(await screen.findByRole("option", { name: /Done/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workItems:journey.transitionUnavailable",
    );
  });

  it("renders the empty state when the server offers no transitions", async () => {
    await renderWithOffers([]);
    expect(
      await screen.findByText("workItems:journey.transitionsEmpty"),
    ).toBeInTheDocument();
  });

  it("renders a retryable error when the offers fail to load", async () => {
    permissionFlags.transition = true;
    transitionsFetcher.mockRejectedValueOnce(new HttpError(500, "boom"));
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={vi.fn()} />,
      ),
    );
    expect(
      await screen.findByText("workItems:journey.transitionsError"),
    ).toBeInTheDocument();
    transitionsFetcher.mockResolvedValue([]);
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:detail.retry" }),
    );
    expect(
      await screen.findByText("workItems:journey.transitionsEmpty"),
    ).toBeInTheDocument();
  });
});

describe("WorkItemJourney access loss (decision log 2026-10-13: a 404 from any work-item mutation)", () => {
  it("reports access loss when the edit answers 404, and shows no draft-conflict message", async () => {
    updateWorkItem.mockRejectedValue(new HttpError(404, "gone"));
    const onAccessLost = vi.fn();
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={onAccessLost} />,
      ),
    );
    openEdit();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    await waitFor(() => expect(onAccessLost).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("workItems:journey.saveError")).toBeNull();
  });

  it("reports access loss when the state change answers 404", async () => {
    permissionFlags.transition = true;
    transitionsFetcher.mockResolvedValue([
      offer({ notePolicy: "none", available: true, blockedBy: [] }),
    ]);
    transitionWorkItem.mockRejectedValue(new HttpError(404, "gone"));
    const onAccessLost = vi.fn();
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={onAccessLost} />,
      ),
    );
    fireEvent.click(
      await screen.findByRole("combobox", {
        name: "workItems:detail.stateLabel",
      }),
    );
    pickOption(await screen.findByRole("option", { name: /Done/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    await waitFor(() => expect(onAccessLost).toHaveBeenCalledTimes(1));
  });

  it("reports access loss when assigning or unassigning answers 404", async () => {
    permissionFlags.assign = false;
    getAssignablePeople.mockResolvedValue([
      { personId: "self", name: "Current Agent", roleName: "Member" },
    ]);
    assignWorkItem.mockRejectedValue(new HttpError(404, "gone"));
    unassignWorkItem.mockRejectedValue(new HttpError(404, "gone"));
    const onAccessLost = vi.fn();
    const view = render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={onAccessLost} />,
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: "workItems:journey.assignToMe",
      }),
    );
    await waitFor(() => expect(onAccessLost).toHaveBeenCalledTimes(1));

    view.unmount();
    render(
      wrap(
        newClient(),
        <WorkItemJourney
          item={makeItem({ assigneeId: "self" })}
          onAccessLost={onAccessLost}
        />,
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "workItems:journey.unassign" }),
    );
    await waitFor(() => expect(onAccessLost).toHaveBeenCalledTimes(2));
  });

  it("reports access loss when the transitions read answers 404, and does not offer a retry", async () => {
    permissionFlags.transition = true;
    transitionsFetcher.mockRejectedValue(new HttpError(404, "gone"));
    const onAccessLost = vi.fn();
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={onAccessLost} />,
      ),
    );
    await waitFor(() => expect(onAccessLost).toHaveBeenCalled());
    expect(
      screen.queryByText("workItems:journey.transitionsError"),
    ).not.toBeInTheDocument();
  });

  it("does not treat other failures as access loss", async () => {
    updateWorkItem.mockRejectedValue(new HttpError(403, "forbidden"));
    const onAccessLost = vi.fn();
    render(
      wrap(
        newClient(),
        <WorkItemJourney item={makeItem()} onAccessLost={onAccessLost} />,
      ),
    );
    openEdit();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.save" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "workItems:journey.saveError",
    );
    expect(onAccessLost).not.toHaveBeenCalled();
  });
});
