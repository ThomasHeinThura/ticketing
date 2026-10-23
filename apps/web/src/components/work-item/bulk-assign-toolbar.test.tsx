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
import BulkAssignToolbar from "./bulk-assign-toolbar";

const mocks = vi.hoisted(() => ({
  assign: vi.fn(),
  operation: vi.fn(),
  deletion: vi.fn(),
  detail: vi.fn(),
  openPending: vi.fn(),
  permissions: vi.fn(),
  canAssign: true,
  canPriority: true,
  canTransition: true,
  canUpdate: true,
  canDelete: true,
  checking: false,
  people: { data: [{ personId: "p1", name: "Riley" }], isError: false },
  states: {
    data: [
      {
        id: "backlog",
        stateTemplateId: "template-backlog",
        name: "Backlog",
        group: "backlog",
      },
      {
        id: "done",
        stateTemplateId: "template-done",
        name: "Done",
        group: "completed",
      },
    ],
    isError: false,
  },
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("@/fetchers/work-item/bulk-assign-work-items", () => ({
  default: (...args: unknown[]) => mocks.assign(...args),
  bulkWorkItemsOperation: (...args: unknown[]) => mocks.operation(...args),
  requestBulkWorkItemDeletion: (...args: unknown[]) => mocks.deletion(...args),
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: (...args: unknown[]) => mocks.detail(...args),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (...args: unknown[]) => {
    mocks.permissions(...args);
    return {
      isCheckingPermissions: mocks.checking,
      canAssignTasks: () => mocks.canAssign,
      canSetPriorityTasks: () => mocks.canPriority,
      canTransitionTasks: () => mocks.canTransition,
      canUpdateTasks: () => mocks.canUpdate,
      canDeleteTasks: () => mocks.canDelete,
    };
  },
}));
vi.mock("@/hooks/queries/work-item/use-get-assignable-people", () => ({
  default: () => mocks.people,
}));
vi.mock("@/hooks/queries/project/use-get-project-states", () => ({
  default: () => mocks.states,
}));
vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({
    data: [
      {
        id: "label-1",
        name: "Access",
        color: "blue",
        workspaceId: "ws_1",
        taskId: null,
      },
    ],
    isError: false,
  }),
}));
vi.mock("@/fetchers/label/project-labels", () => ({
  getProjectLabels: async () => [],
}));
vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (value: string) => value,
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.canAssign =
    mocks.canPriority =
    mocks.canTransition =
    mocks.canUpdate =
    mocks.canDelete =
      true;
  mocks.checking = false;
  mocks.people.isError = false;
  mocks.detail.mockImplementation(async (key: string) => ({
    key,
    workspaceId: "ws_1",
    projectId: "proj_1",
    assigneeId: null,
    assigneeName: null,
  }));
  mocks.assign.mockResolvedValue({ succeeded: ["WLP-1"], failed: [] });
  mocks.operation.mockResolvedValue({ succeeded: ["WLP-1"], failed: [] });
});
function mount(
  overrides: Partial<Parameters<typeof BulkAssignToolbar>[0]> = {},
) {
  const onAssigned = vi.fn();
  const onClear = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const props = {
    projectId: "proj_1",
    workspaceId: "ws_1",
    selectedKeys: ["WLP-1", "WLP-2"],
    onAssigned,
    onClear,
    ...overrides,
  };
  const view = render(
    <QueryClientProvider client={client}>
      <BulkAssignToolbar {...props} />
    </QueryClientProvider>,
  );
  return {
    onAssigned,
    onClear,
    client,
    ...view,
    rerenderToolbar: (next: Partial<typeof props>) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <BulkAssignToolbar {...props} {...next} />
        </QueryClientProvider>,
      ),
  };
}
async function openActions() {
  fireEvent.click(screen.getByRole("button", { name: "Actions" }));
  await screen.findByPlaceholderText("Search actions...");
}
async function choose(name: string) {
  await openActions();
  fireEvent.click(await screen.findByRole("option", { name }));
}

describe("canonical bulk actions use original Kaneo composition", () => {
  it("uses the floating toolbar and searchable command actions, not inline form controls", async () => {
    mount();
    expect(
      screen.getByRole("toolbar", { name: "Bulk actions" }),
    ).toBeInTheDocument();
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    await openActions();
    expect(
      await screen.findByRole("option", { name: "Archive tasks" }),
    ).toBeInTheDocument();
    expect(mocks.permissions).toHaveBeenCalledWith("ws_1", "proj_1");
  });
  it("clears the selection through the original icon button", () => {
    const { onClear } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
  it("uses canonical state-template targets and existing bulk transitions", async () => {
    mount();
    await choose("Done");
    await waitFor(() =>
      expect(mocks.operation).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        workItemKeys: ["WLP-1", "WLP-2"],
        operation: "transition",
        toStateTemplateId: "template-done",
      }),
    );
  });
  it("maps the original backlog shortcut to a concrete project state, never planned", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Move to Backlog" }));
    await waitFor(() =>
      expect(mocks.operation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "transition",
          toStateTemplateId: "template-backlog",
        }),
      ),
    );
  });
  it("per-item partial results retain failures and only release succeeded keys", async () => {
    mocks.operation.mockResolvedValue({
      succeeded: ["WLP-1"],
      failed: [{ id: "WLP-2", reason: "Work item not found" }],
    });
    const { onAssigned } = mount();
    await choose("high");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 updated, 1 failed.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "WLP-2: no longer available to you",
    );
    expect(onAssigned).toHaveBeenCalledWith(["WLP-1"]);
    expect(mocks.operation).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "set_priority", priority: "high" }),
    );
  });
  it("preserves operation refusal and the selection", async () => {
    mocks.operation.mockRejectedValue(new HttpError(403, "denied"));
    const { onAssigned } = mount();
    await choose("Archive tasks");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(onAssigned).not.toHaveBeenCalled();
  });
  it("offers only permitted actions, independently of assignment authority", async () => {
    mocks.canAssign =
      mocks.canTransition =
      mocks.canUpdate =
      mocks.canDelete =
        false;
    mount();
    await openActions();
    expect(screen.queryByRole("option", { name: "Riley" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Delete tasks" })).toBeNull();
    expect(screen.queryByRole("option", { name: "Archive tasks" })).toBeNull();
    expect(screen.getByRole("option", { name: "high" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Set Due Date" })).toBeNull();
  });
  it("fails closed while scoped permissions load", () => {
    mocks.checking = true;
    mount();
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
  it("has separate add/remove label groups wired to atomic canonical operations", async () => {
    mount();
    await openActions();
    const options = await screen.findAllByRole("option", { name: "Access" });
    fireEvent.click(options[0]);
    await waitFor(() =>
      expect(mocks.operation).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "add_label", labelId: "label-1" }),
      ),
    );
    await openActions();
    fireEvent.click(
      (await screen.findAllByRole("option", { name: "Access" }))[1],
    );
    await waitFor(() =>
      expect(mocks.operation).toHaveBeenLastCalledWith(
        expect.objectContaining({
          operation: "remove_label",
          labelId: "label-1",
        }),
      ),
    );
  });
  it("sets a Calendar day as UTC midnight without timezone drift", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Set Due Date" }));
    const grid = await screen.findByRole("grid");
    const day = within(grid)
      .getAllByRole("button")
      .find((button) => button.textContent === "15");
    expect(day).toBeDefined();
    fireEvent.click(day as HTMLElement);
    await waitFor(() =>
      expect(mocks.operation).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "set_due_date",
          dueDate: expect.stringMatching(/-15T00:00:00\.000Z$/),
        }),
      ),
    );
  });
  it("clears the due date through the original Calendar popover", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Set Due Date" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear date" }));
    await waitFor(() =>
      expect(mocks.operation).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "set_due_date", dueDate: null }),
      ),
    );
  });
});

describe("bulk assignment CAS and intent", () => {
  it("checks every actual holder and includes an observed CAS map for an unassigned selection", async () => {
    const { onAssigned } = mount();
    await choose("Riley");
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        workItemKeys: ["WLP-1", "WLP-2"],
        operation: "assign",
        assigneeId: "p1",
        expectedCurrentAssigneeIds: { "WLP-1": null, "WLP-2": null },
      }),
    );
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    expect(onAssigned).toHaveBeenCalledWith(["WLP-1"]);
  });
  it("keeps failed holder reads selected while assigning the independently reachable items", async () => {
    mocks.detail.mockImplementation(async (key: string) => {
      if (key === "WLP-2") throw new HttpError(404, "secret reason");
      return {
        key,
        workspaceId: "ws_1",
        projectId: "proj_1",
        assigneeId: null,
        assigneeName: null,
      };
    });
    const { onAssigned } = mount();
    await choose("Riley");
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith(
        expect.objectContaining({
          workItemKeys: ["WLP-1"],
          expectedCurrentAssigneeIds: { "WLP-1": null },
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 updated, 1 failed.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "WLP-2: no longer available to you",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("secret reason");
    expect(onAssigned).toHaveBeenCalledWith(["WLP-1"]);
  });
  it("bounds holder reads to eight and stops queued reads after switching projects", async () => {
    const pending: ((value: unknown) => void)[] = [];
    mocks.detail.mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const { rerenderToolbar, onAssigned } = mount({
      selectedKeys: Array.from(
        { length: 20 },
        (_, index) => `WLP-${index + 1}`,
      ),
    });
    await choose("Riley");
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(8));
    rerenderToolbar({ projectId: "other", selectedKeys: ["OTHER-1"] });
    await act(async () => {
      for (const resolve of pending)
        resolve({
          workspaceId: "ws_1",
          projectId: "proj_1",
          assigneeId: null,
          assigneeName: null,
        });
    });
    expect(mocks.detail).toHaveBeenCalledTimes(8);
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(onAssigned).not.toHaveBeenCalled();
  });
  it("names every replaced holder and requires one confirmation before sending observed CAS", async () => {
    mocks.detail.mockImplementation(async (key: string) => ({
      key,
      workspaceId: "ws_1",
      projectId: "proj_1",
      assigneeId: key === "WLP-1" ? "old1" : "old2",
      assigneeName: key === "WLP-1" ? "Grace" : "Alan",
    }));
    mount();
    await choose("Riley");
    const confirm = await screen.findByRole("alertdialog");
    expect(confirm).toHaveTextContent("WLP-1 — Grace");
    expect(confirm).toHaveTextContent("WLP-2 — Alan");
    expect(mocks.assign).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirm).getByRole("button", { name: "Confirm assignment" }),
    );
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedCurrentAssigneeIds: { "WLP-1": "old1", "WLP-2": "old2" },
        }),
      ),
    );
  });
  it("cancelling replacement does not mutate any selected item", async () => {
    mocks.detail.mockResolvedValue({
      workspaceId: "ws_1",
      projectId: "proj_1",
      assigneeId: "old",
      assigneeName: "Grace",
    });
    mount();
    await choose("Riley");
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.assign).not.toHaveBeenCalled();
  });
  it("invalidates a confirmation when the selected keys change", async () => {
    mocks.detail.mockResolvedValue({
      workspaceId: "ws_1",
      projectId: "proj_1",
      assigneeId: "old",
      assigneeName: "Grace",
    });
    const { rerenderToolbar } = mount();
    await choose("Riley");
    await screen.findByRole("alertdialog");
    rerenderToolbar({ selectedKeys: ["WLP-2"] });
    expect(
      screen.queryByRole("button", { name: "Confirm assignment" }),
    ).toBeNull();
    expect(mocks.assign).not.toHaveBeenCalled();
  });
  it("does not apply a late bulk response to a new project", async () => {
    let finish!: (value: unknown) => void;
    mocks.operation.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { onAssigned, rerenderToolbar } = mount();
    await choose("high");
    await waitFor(() => expect(mocks.operation).toHaveBeenCalled());
    rerenderToolbar({ projectId: "proj_2", selectedKeys: ["OTHER-1"] });
    await act(async () => finish({ succeeded: ["WLP-1"], failed: [] }));
    expect(onAssigned).not.toHaveBeenCalled();
  });
});

describe("bulk durable deletion", () => {
  it("opens exact pending confirmation and does not report requested items deleted", async () => {
    mocks.deletion.mockResolvedValue({
      kind: "pending",
      pendingActionId: "pa-bulk",
    });
    const { onAssigned } = mount();
    await choose("Delete tasks");
    await waitFor(() =>
      expect(mocks.openPending).toHaveBeenCalledWith({
        pendingActionId: "pa-bulk",
      }),
    );
    expect(onAssigned).not.toHaveBeenCalled();
  });
  it("does not open the approval after unmount", async () => {
    let finish!: (value: unknown) => void;
    mocks.deletion.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    await choose("Delete tasks");
    await waitFor(() => expect(mocks.deletion).toHaveBeenCalled());
    cleanup();
    await act(async () =>
      finish({ kind: "pending", pendingActionId: "stale" }),
    );
    expect(mocks.openPending).not.toHaveBeenCalled();
  });
});
