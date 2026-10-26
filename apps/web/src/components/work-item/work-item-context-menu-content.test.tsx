import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button, ContextMenu } from "@taskdesk/ui";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type TaskContextMenuPresentation from "@/components/kanban-board/task-card-context-menu/task-context-menu-presentation";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import { WorkItemTransitionBlockedError } from "@/lib/work-item-transition-reasons";
import { translate } from "@/test/en-translation";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemContextMenuContent from "./work-item-context-menu-content";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  transition: vi.fn(),
  offers: vi.fn(),
  people: vi.fn(),
  assign: vi.fn(),
  unassign: vi.fn(),
  archive: vi.fn(),
  deletion: vi.fn(),
  openPending: vi.fn(),
  children: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  permission: vi.fn(),
  row: undefined as WorkItemDetailRow | undefined,
  capabilities: {
    update: true,
    create: true,
    priority: true,
    transition: true,
    assign: true,
    delete: true,
    checking: false,
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate }),
  initReactI18next: { type: "3rdParty", init() {} },
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPending,
}));
vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: (...args: unknown[]) => {
    mocks.permission(...args);
    return {
      isCheckingPermissions: mocks.capabilities.checking,
      canUpdateTasks: () => mocks.capabilities.update,
      canCreateTasks: () => mocks.capabilities.create,
      canSetPriorityTasks: () => mocks.capabilities.priority,
      canTransitionTasks: () => mocks.capabilities.transition,
      canAssignTasks: () => mocks.capabilities.assign,
      canDeleteTasks: () => mocks.capabilities.delete,
    };
  },
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: (...args: unknown[]) => mocks.read(...args),
}));
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: (...args: unknown[]) => mocks.update(...args),
}));
vi.mock("@/fetchers/work-item/get-hierarchy-children", () => ({
  getHierarchyChildren: (...args: unknown[]) => mocks.children(...args),
}));
vi.mock("@/fetchers/work-item/get-work-item-transitions", () => ({
  default: (...args: unknown[]) => mocks.offers(...args),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: (...args: unknown[]) => mocks.transition(...args),
}));
vi.mock("@/fetchers/work-item/get-assignable-people", () => ({
  default: (...args: unknown[]) => mocks.people(...args),
}));
vi.mock("@/fetchers/work-item/assign-work-item", () => ({
  default: (...args: unknown[]) => mocks.assign(...args),
}));
vi.mock("@/fetchers/work-item/unassign-work-item", () => ({
  default: (...args: unknown[]) => mocks.unassign(...args),
}));
vi.mock("@/fetchers/work-item/archive-work-item", () => ({
  default: (...args: unknown[]) => mocks.archive(...args),
}));
vi.mock("@/fetchers/work-item/request-work-item-deletion", () => ({
  default: (...args: unknown[]) => mocks.deletion(...args),
}));
vi.mock(
  "@/components/kanban-board/task-card-context-menu/task-context-menu-presentation",
  () => ({
    default: (props: ComponentProps<typeof TaskContextMenuPresentation>) => (
      <div>
        <Button type="button" onClick={props.onCopyLink}>
          Copy
        </Button>
        {props.status}
        {props.priority ? (
          <Button
            type="button"
            disabled={props.disabled}
            onClick={() => props.priority?.onChange("high")}
          >
            Priority high
          </Button>
        ) : null}
        {props.states?.options.map((state) => (
          <Button
            type="button"
            disabled={props.disabled || state.disabled}
            key={state.value}
            onClick={() => props.states?.onChange(state.value)}
          >
            State {state.name}
          </Button>
        ))}
        {props.dueDate ? (
          <>
            <Button
              type="button"
              disabled={props.disabled}
              onClick={() => props.dueDate?.onChange(new Date(2026, 11, 4))}
            >
              Due day
            </Button>
            <Button
              type="button"
              disabled={props.disabled}
              onClick={() => props.dueDate?.onChange(undefined)}
            >
              Clear due
            </Button>
          </>
        ) : null}
        {props.assignee?.options.map((person) => (
          <Button
            type="button"
            key={person.value}
            disabled={props.disabled}
            onClick={() => props.assignee?.onChange(person.value)}
          >
            Assign {person.label}
          </Button>
        ))}
        {props.assignee ? (
          <Button
            type="button"
            disabled={props.disabled || props.assignee.canUnassign === false}
            onClick={() => props.assignee?.onChange("")}
          >
            Unassign
          </Button>
        ) : null}
        {props.onArchive ? (
          <Button
            type="button"
            disabled={props.disabled}
            onClick={props.onArchive}
          >
            Archive
          </Button>
        ) : null}
        {props.onDelete ? (
          <Button
            type="button"
            disabled={props.disabled}
            onClick={props.onDelete}
          >
            Delete request
          </Button>
        ) : null}
      </div>
    ),
  }),
);
function row(): WorkItemDetailRow {
  return {
    id: "item",
    key: "HELP-7",
    number: 7,
    projectId: "project",
    workspaceId: "workspace",
    typeId: "type",
    title: "Real task",
    description: null,
    stateId: "open",
    stateName: "Open",
    stateCategory: "unstarted",
    priority: null,
    assigneeId: null,
    assigneeName: null,
    requesterId: null,
    parentId: null,
    customerVisibility: "private",
    archivedAt: null,
    deletedAt: null,
    position: "1",
    startDate: null,
    dueDate: "2026-10-22T15:30:00.000Z",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    version: 4,
    unavailableFields: [],
    defaultCommentVisibility: "internal",
    customFields: [],
  } as WorkItemDetailRow;
}
function mount(keyboardAnchor?: HTMLElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const close = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <ContextMenu open>
        <WorkItemContextMenuContent
          itemKey="HELP-7"
          workspaceId="workspace"
          projectId="project"
          keyboardAnchor={keyboardAnchor}
          open
          onClose={close}
        />
      </ContextMenu>
    </QueryClientProvider>,
  );
  return { client, close, ...view };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = row();
  mocks.capabilities = {
    update: true,
    create: true,
    priority: true,
    transition: true,
    assign: true,
    delete: true,
    checking: false,
  };
  mocks.read.mockImplementation(async () => mocks.row);
  mocks.update.mockImplementation(async (input) => {
    mocks.row = {
      ...mocks.row,
      ...input,
      version: input.version + 1,
    } as WorkItemDetailRow;
    return mocks.row;
  });
  mocks.offers.mockResolvedValue([
    {
      transitionId: "edge",
      toStateId: "done",
      toStateTemplateId: "template-done",
      toStateName: "Done",
      available: true,
      blockedBy: [],
    },
  ]);
  mocks.people.mockResolvedValue([
    {
      personId: "person",
      name: "Jordan",
      roleName: "Member",
      openWorkCount: 0,
    },
  ]);
  mocks.children.mockResolvedValue({
    data: [],
    progress: { total: 0, completed: 0 },
  });
  mocks.assign.mockResolvedValue({ key: "HELP-7", version: 5 });
  mocks.unassign.mockResolvedValue({ key: "HELP-7", version: 5 });
  mocks.transition.mockResolvedValue({ key: "HELP-7", version: 5 });
  mocks.archive.mockResolvedValue({ key: "HELP-7", version: 5 });
  mocks.deletion.mockResolvedValue({ pendingActionId: "pending-7" });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);
it("waits for a fresh scoped detail version, then PATCHes a genuine priority", async () => {
  let resolve!: (value: WorkItemDetailRow) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount();
  expect(
    screen.queryByRole("button", { name: "Priority high" }),
  ).not.toBeInTheDocument();
  resolve(row());
  fireEvent.click(await screen.findByRole("button", { name: "Priority high" }));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith({
      key: "HELP-7",
      version: 4,
      priority: "high",
    }),
  );
  expect(mocks.permission).toHaveBeenCalledWith("workspace", "project");
});
it("copies the canonical permanent link without touching browser view state", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Priority high" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    `${window.location.origin}/agent/work-items/HELP-7`,
  );
  expect(mocks.openPending).not.toHaveBeenCalled();
});
it("returns keyboard context-menu focus to its original anchor after requesting deletion", async () => {
  const keyboardAnchor = document.createElement("button");
  keyboardAnchor.textContent = "Work item keyboard anchor";
  document.body.append(keyboardAnchor);
  const { close } = mount(keyboardAnchor);

  fireEvent.click(
    await screen.findByRole("button", { name: "Delete request" }),
  );

  await waitFor(() =>
    expect(mocks.openPending).toHaveBeenCalledWith({
      pendingActionId: "pending-7",
      finalFocus: expect.any(Function),
    }),
  );
  const finalFocus = mocks.openPending.mock.calls[0]?.[0]?.finalFocus as
    | (() => HTMLElement | false)
    | undefined;
  expect(finalFocus?.()).toBe(keyboardAnchor);
  expect(close).toHaveBeenCalledOnce();
  keyboardAnchor.remove();
});
it("uses only the actor-offered transition template and never a fake state alias", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "State Done" }));
  await waitFor(() =>
    expect(mocks.transition).toHaveBeenCalledWith({
      key: "HELP-7",
      toStateTemplateId: "template-done",
    }),
  );
  expect(mocks.update).not.toHaveBeenCalled();
});
const closingOffer = [
  {
    transitionId: "edge",
    toStateId: "done",
    toStateTemplateId: "template-done",
    toStateName: "Done",
    toStateCategory: "completed",
    available: true,
    blockedBy: [],
  },
];
it("asks about open children before the menu closes a parent, then moves only after confirming", async () => {
  mocks.offers.mockResolvedValue(closingOffer);
  mocks.children.mockResolvedValue({
    data: [
      {
        key: "HELP-8",
        title: "Child",
        stateName: "Open",
        stateCategory: "unstarted",
      },
    ],
    progress: { total: 1, completed: 0 },
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "State Done" }));
  expect(
    await screen.findByTestId("open-children-warning"),
  ).toBeInTheDocument();
  expect(mocks.transition).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: /Close anyway|openChildren\.confirm/ }),
  );
  await waitFor(() =>
    expect(mocks.transition).toHaveBeenCalledWith({
      key: "HELP-7",
      toStateTemplateId: "template-done",
    }),
  );
});
it("leaves the parent open when the open-children warning is cancelled", async () => {
  mocks.offers.mockResolvedValue(closingOffer);
  mocks.children.mockResolvedValue({
    data: [],
    progress: { total: 2, completed: 0 },
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "State Done" }));
  await screen.findByTestId("open-children-warning");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByTestId("open-children-warning")).toBeNull(),
  );
  expect(mocks.transition).not.toHaveBeenCalled();
});
it("preserves the UTC time of day while changing the selected calendar day", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Due day" }));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith({
      key: "HELP-7",
      version: 4,
      dueDate: "2026-12-04T15:30:00.000Z",
    }),
  );
});
it("clears a due date explicitly with the fresh version", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Clear due" }));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith({
      key: "HELP-7",
      version: 4,
      dueDate: null,
    }),
  );
});
it("assigns a real scoped person with the observed holder guard", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Assign Jordan" }));
  await waitFor(() =>
    expect(mocks.assign).toHaveBeenCalledWith({
      key: "HELP-7",
      assigneeId: "person",
      expectedCurrentAssigneeId: null,
    }),
  );
});
it("asks before reassigning and confirms the exact holder it showed", async () => {
  mocks.row = {
    ...row(),
    assigneeId: "holder",
    assigneeName: "Current holder",
  };
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Assign Jordan" }));
  expect(mocks.assign).not.toHaveBeenCalled();
  fireEvent.click(
    await screen.findByRole("button", {
      name: translate("workItems:journey.confirmAssignment"),
    }),
  );
  await waitFor(() =>
    expect(mocks.assign).toHaveBeenCalledWith({
      key: "HELP-7",
      assigneeId: "person",
      expectedCurrentAssigneeId: "holder",
    }),
  );
});
it("archives exactly one canonical key through the versioned archive route", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
  await waitFor(() =>
    expect(mocks.archive).toHaveBeenCalledWith({
      key: "HELP-7",
      version: 4,
    }),
  );
  expect(mocks.transition).not.toHaveBeenCalled();
  expect(mocks.deletion).not.toHaveBeenCalled();
});
it("requests pending deletion, retains cached item and opens real confirmation", async () => {
  const { client } = mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete request" }),
  );
  await waitFor(() =>
    expect(mocks.openPending).toHaveBeenCalledWith({
      pendingActionId: "pending-7",
      finalFocus: expect.any(Function),
    }),
  );
  expect(mocks.deletion).toHaveBeenCalledWith("HELP-7", expect.anything());
  expect(client.getQueryData(["work-items", "detail", "HELP-7"])).toBeDefined();
});
it("does not offer mutation controls without strict capabilities", async () => {
  mocks.capabilities = {
    update: false,
    create: false,
    priority: false,
    transition: false,
    assign: false,
    delete: false,
    checking: false,
  };
  mount();
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.queryByText(translate("common:empty.loading")),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Copy"]);
});
it("refuses a detail row from another project even when the key matches", async () => {
  mocks.row = { ...row(), projectId: "other-project" };
  mount();
  await waitFor(() => expect(mocks.read).toHaveBeenCalled());
  expect(
    screen.queryByRole("button", { name: "Archive" }),
  ).not.toBeInTheDocument();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.deletion).not.toHaveBeenCalled();
});
it("refreshes and explains a version conflict without replaying the change", async () => {
  mocks.update.mockRejectedValue(new WorkItemVersionConflictError(4, 5));
  const { client } = mount();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  fireEvent.click(await screen.findByRole("button", { name: "Priority high" }));
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(
      translate("workItems:properties.conflict"),
    ),
  );
  expect(mocks.update).toHaveBeenCalledOnce();
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["work-items", "project"],
  });
});
it("never clears another holder for an update-only actor", async () => {
  mocks.capabilities.assign = false;
  mocks.row = {
    ...row(),
    assigneeId: "holder",
    assigneeName: "Current holder",
  };
  mount();
  expect(
    await screen.findByRole("button", { name: "Unassign" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Unassign" }));
  expect(mocks.unassign).not.toHaveBeenCalled();
});
it("reports a refused archive instead of showing success", async () => {
  mocks.archive.mockRejectedValue(new HttpError(422, "Archive refused"));
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Archive" }));
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(
      translate("workItems:properties.saveFailed"),
    ),
  );
  expect(mocks.success).not.toHaveBeenCalled();
});
it("handles a failed pending deletion without navigation or a success claim", async () => {
  mocks.deletion.mockRejectedValue(new HttpError(403, "Private denial"));
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Delete request" }),
  );
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(
      translate("workItems:deletion.requestFailed"),
    ),
  );
  expect(mocks.openPending).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});

it("keeps actor-offered blocked states disabled and displays translated reasons", async () => {
  mocks.offers.mockResolvedValue([
    {
      transitionId: "edge",
      toStateId: "done",
      toStateTemplateId: "template-done",
      toStateName: "Done",
      available: false,
      blockedBy: [{ reasonCode: "cab.pending" }],
    },
  ]);
  mount();
  const state = await screen.findByRole("button", { name: /State Done/ });
  expect(state).toBeDisabled();
  expect(state).toHaveTextContent(
    translate("workItems:journey.reasonCabPending"),
  );
  expect(state).not.toHaveTextContent("cab.pending");
  fireEvent.click(state);
  expect(mocks.transition).not.toHaveBeenCalled();
});
it("explains a newly blocked POST without exposing pending approver data or raw codes", async () => {
  mocks.transition.mockRejectedValue(
    new WorkItemTransitionBlockedError([
      "approval.pending",
      "unknown.private.value",
    ]),
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "State Done" }));
  await waitFor(() =>
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining(
        translate("workItems:journey.reasonApprovalPending"),
      ),
    ),
  );
  expect(String(mocks.error.mock.calls[0][0])).not.toContain(
    "approval.pending",
  );
  expect(String(mocks.error.mock.calls[0][0])).not.toContain(
    "unknown.private.value",
  );
  expect(mocks.success).not.toHaveBeenCalled();
});
it("does not expose a stale roster after its current scoped request is denied", async () => {
  mocks.people.mockRejectedValue(new HttpError(403, "private denial"));
  mount();
  await screen.findByText(translate("workItems:journey.peopleError"));
  expect(
    screen.queryByRole("button", { name: "Assign Jordan" }),
  ).not.toBeInTheDocument();
  expect(mocks.assign).not.toHaveBeenCalled();
});
it("sends no redundant field write for the already selected priority", async () => {
  mocks.row = { ...row(), priority: "high" };
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Priority high" }));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.success).not.toHaveBeenCalled();
});
it("does not offer priority with set-priority alone when the PATCH update capability is absent", async () => {
  mocks.capabilities.update = false;
  mount();
  await screen.findByRole("button", { name: "Delete request" });
  expect(
    screen.queryByRole("button", { name: "Priority high" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Due day" }),
  ).not.toBeInTheDocument();
});
it("suppresses duplicate command dispatch before the pending render", async () => {
  let resolve!: (value: unknown) => void;
  mocks.update.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  mount();
  const priority = await screen.findByRole("button", { name: "Priority high" });
  fireEvent.click(priority);
  fireEvent.click(priority);
  await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  resolve({ key: "HELP-7", version: 5 });
  await waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
});
