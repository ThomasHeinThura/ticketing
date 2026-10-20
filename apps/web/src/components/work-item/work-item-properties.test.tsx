import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemProperties from "./work-item-properties";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  transition: vi.fn(),
  assign: vi.fn(),
  unassign: vi.fn(),
  toastError: vi.fn(),
  canUpdate: true,
  canAssign: true,
  canTransition: true,
  canSetPriority: true,
  transitions: [] as unknown[],
  transitionsError: null as unknown,
  people: [] as unknown[],
  peopleError: null as unknown,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: mocks.update,
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: mocks.transition,
}));
vi.mock("@/fetchers/work-item/assign-work-item", () => ({
  default: mocks.assign,
}));
vi.mock("@/fetchers/work-item/unassign-work-item", () => ({
  default: mocks.unassign,
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.toastError, success: vi.fn() },
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => mocks.canUpdate,
    canAssignTasks: () => mocks.canAssign,
    canTransitionTasks: () => mocks.canTransition,
    canSetPriorityTasks: () => mocks.canSetPriority,
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-transitions", () => ({
  default: () => ({
    data: mocks.transitionsError ? undefined : mocks.transitions,
    error: mocks.transitionsError,
    isError: Boolean(mocks.transitionsError),
    isLoading: false,
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-assignable-people", () => ({
  default: () => ({
    data: mocks.peopleError ? undefined : mocks.people,
    error: mocks.peopleError,
    isError: Boolean(mocks.peopleError),
    isLoading: false,
  }),
}));

function item(overrides: Partial<WorkItemDetailRow> = {}) {
  return {
    key: "HELP-7",
    projectId: "p1",
    workspaceId: "w1",
    stateName: "To do",
    stateCategory: "unstarted",
    priority: "high",
    assigneeId: null,
    assigneeName: null,
    startDate: null,
    dueDate: null,
    version: 4,
    unavailableFields: [],
    ...overrides,
  } as unknown as WorkItemDetailRow;
}

function renderProps(node: ReactNode, seed?: WorkItemDetailRow) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (seed) client.setQueryData(["work-items", "detail", seed.key], seed);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>{node}</QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  for (const fn of [
    mocks.update,
    mocks.transition,
    mocks.assign,
    mocks.unassign,
    mocks.toastError,
  ]) {
    fn.mockReset();
  }
  mocks.canUpdate = true;
  mocks.canAssign = true;
  mocks.canTransition = true;
  mocks.canSetPriority = true;
  mocks.transitions = [];
  mocks.transitionsError = null;
  mocks.people = [];
  mocks.peopleError = null;
});

describe("WorkItemProperties", () => {
  it("saves a priority with the item's version", async () => {
    mocks.update.mockResolvedValue({});
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Urgent/ }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 4,
        priority: "urgent",
      }),
    );
  });

  it("shows a version conflict inline with a way to reload the latest", async () => {
    mocks.update.mockRejectedValue(new WorkItemVersionConflictError(4, 5));
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Low/ }));
    const notice = await screen.findByTestId("work-item-conflict");
    expect(notice).toHaveTextContent("workItems:properties.conflict");
    expect(mocks.toastError).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:properties.reloadLatest" }),
    );
    expect(screen.queryByTestId("work-item-conflict")).toBeNull();
  });

  it("sends the version the last save returned, not the one it rendered with", async () => {
    mocks.update
      .mockResolvedValueOnce({ key: "HELP-7", version: 5, priority: "low" })
      .mockResolvedValueOnce({ key: "HELP-7", version: 6, priority: "urgent" });
    const current = item();
    renderProps(
      <WorkItemProperties item={current} onAccessLost={vi.fn()} />,
      current,
    );
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    fireEvent.click(await screen.findByRole("button", { name: /Low/ }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Urgent/ })).toBeNull(),
    );
    // The row still renders version 4 (no refetch has landed); the save must not.
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    fireEvent.click(await screen.findByRole("button", { name: /Urgent/ }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[0]?.[0]).toMatchObject({ version: 4 });
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({ version: 5 });
  });

  it("keeps priority read-only without work_item:set_priority", () => {
    mocks.canSetPriority = false;
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    expect(screen.queryByRole("button", { name: /Urgent/ })).toBeNull();
  });

  it("shows an unavailable field read-only with its badge", () => {
    renderProps(
      <WorkItemProperties
        item={item({ unavailableFields: ["priority", "dueDate", "stateName"] })}
        onAccessLost={vi.fn()}
      />,
    );
    for (const field of ["priority", "dueDate", "stateName"]) {
      expect(
        screen.getByTestId(`work-item-${field}-unavailable`),
      ).toHaveTextContent("workItems:detail.unavailable");
    }
    expect(screen.queryByTestId("work-item-priority-control")).toBeNull();
    expect(screen.queryByTestId("work-item-state-control")).toBeNull();
    expect(screen.queryByTestId("work-item-dueDate-control")).toBeNull();
    expect(screen.getByTestId("work-item-startDate-control")).toBeEnabled();
  });

  it("treats a 404 from the transitions query as access lost", async () => {
    mocks.transitionsError = new HttpError(404, "gone");
    const onAccessLost = vi.fn();
    renderProps(
      <WorkItemProperties item={item()} onAccessLost={onAccessLost} />,
    );
    await waitFor(() => expect(onAccessLost).toHaveBeenCalled());
  });

  it("gives a refused transition its specific message", async () => {
    mocks.transition.mockRejectedValue(new HttpError(422, "blocked"));
    mocks.transitions = [
      {
        transitionId: "t1",
        toStateTemplateId: "tpl-progress",
        toStateName: "In progress",
        notePolicy: "none",
        available: true,
        blockedBy: [],
      },
    ];
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    fireEvent.click(await screen.findByRole("button", { name: /In progress/ }));
    expect(
      await screen.findByText("workItems:journey.transitionUnavailable"),
    ).toBeInTheDocument();
  });

  it("disables an unavailable transition even when it gives no reason", async () => {
    mocks.transitions = [
      {
        transitionId: "t9",
        toStateTemplateId: "tpl-held",
        toStateName: "Held",
        notePolicy: "none",
        available: false,
        blockedBy: [],
      },
    ];
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    const held = await screen.findByRole("button", { name: /Held/ });
    expect(held).toBeDisabled();
    expect(held).toHaveTextContent("workItems:journey.reasonUnknown");
  });

  it("moves with an optional note left empty, sending no note", async () => {
    mocks.transition.mockResolvedValue({ key: "HELP-7", version: 5 });
    mocks.transitions = [
      {
        transitionId: "t4",
        toStateTemplateId: "tpl-review",
        toStateName: "Review",
        notePolicy: "optional",
        available: true,
        blockedBy: [],
      },
    ];
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    fireEvent.click(await screen.findByRole("button", { name: /Review/ }));
    const move = screen.getByRole("button", {
      name: "workItems:properties.move",
    });
    expect(move).toBeEnabled();
    fireEvent.click(move);
    await waitFor(() =>
      expect(mocks.transition.mock.calls[0]?.[0]).toEqual({
        key: "HELP-7",
        toStateTemplateId: "tpl-review",
      }),
    );
    expect(await screen.findByTestId("work-item-status")).toHaveTextContent(
      "workItems:journey.transitionDone",
    );
  });

  it("treats a 404 from any change as access lost", async () => {
    mocks.update.mockRejectedValue(new HttpError(404, "gone"));
    const onAccessLost = vi.fn();
    renderProps(
      <WorkItemProperties item={item()} onAccessLost={onAccessLost} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Low/ }));
    await waitFor(() => expect(onAccessLost).toHaveBeenCalledTimes(1));
  });

  it("moves through an available transition and disables a blocked one with its reason", async () => {
    mocks.transition.mockResolvedValue({});
    mocks.transitions = [
      {
        transitionId: "t1",
        toStateTemplateId: "tpl-progress",
        toStateName: "In progress",
        notePolicy: "none",
        available: true,
        blockedBy: [],
      },
      {
        transitionId: "t2",
        toStateTemplateId: "tpl-done",
        toStateName: "Done",
        notePolicy: "none",
        available: false,
        blockedBy: [{ kind: "approval", reasonCode: "approval.pending" }],
      },
    ];
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    const blocked = await screen.findByRole("button", { name: /Done/ });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveTextContent(
      "workItems:journey.reasonApprovalPending",
    );
    fireEvent.click(screen.getByRole("button", { name: /In progress/ }));
    await waitFor(() =>
      expect(mocks.transition.mock.calls[0]?.[0]).toEqual({
        key: "HELP-7",
        toStateTemplateId: "tpl-progress",
      }),
    );
  });

  it("asks for the note a transition requires before moving", async () => {
    mocks.transition.mockResolvedValue({});
    mocks.transitions = [
      {
        transitionId: "t3",
        toStateTemplateId: "tpl-closed",
        toStateName: "Closed",
        notePolicy: "required",
        available: false,
        blockedBy: [{ kind: "note", reasonCode: "note.required" }],
      },
    ];
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    fireEvent.click(await screen.findByRole("button", { name: /Closed/ }));
    const move = screen.getByRole("button", {
      name: "workItems:properties.move",
    });
    expect(move).toBeDisabled();
    fireEvent.change(
      screen.getByLabelText("workItems:properties.transitionNote"),
      { target: { value: "Resolved by reset" } },
    );
    fireEvent.click(move);
    await waitFor(() =>
      expect(mocks.transition.mock.calls[0]?.[0]).toEqual({
        key: "HELP-7",
        toStateTemplateId: "tpl-closed",
        note: "Resolved by reset",
      }),
    );
  });

  it("asks before taking work from its current holder, then assigns with that holder", async () => {
    mocks.assign.mockResolvedValue({ key: "HELP-7", version: 5 });
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    renderProps(
      <WorkItemProperties
        item={item({ assigneeId: "person-1", assigneeName: "Riley Fox" })}
        onAccessLost={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Riley Fox/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Casey Ray/ }));
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(
      screen.getByText("workItems:journey.confirmReassignDescription"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:journey.confirmAssignment",
      }),
    );
    await waitFor(() =>
      expect(mocks.assign.mock.calls[0]?.[0]).toEqual({
        key: "HELP-7",
        assigneeId: "person-2",
        expectedCurrentAssigneeId: "person-1",
      }),
    );
  });

  it("assigns an unassigned item without asking", async () => {
    mocks.assign.mockResolvedValue({ key: "HELP-7", version: 5 });
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-assignee-control"));
    fireEvent.click(await screen.findByRole("button", { name: /Casey Ray/ }));
    await waitFor(() =>
      expect(mocks.assign.mock.calls[0]?.[0]).toEqual({
        key: "HELP-7",
        assigneeId: "person-2",
        expectedCurrentAssigneeId: null,
      }),
    );
  });

  it("cancels a take-over without assigning", async () => {
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    renderProps(
      <WorkItemProperties
        item={item({ assigneeId: "person-1", assigneeName: "Riley Fox" })}
        onAccessLost={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Riley Fox/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Casey Ray/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:journey.cancel" }),
    );
    expect(
      await screen.findByRole("button", { name: /Casey Ray/ }),
    ).toBeInTheDocument();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("shows every property read-only to a role that cannot change them", () => {
    mocks.canUpdate = false;
    mocks.canAssign = false;
    mocks.canTransition = false;
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    expect(screen.queryByRole("button", { name: /Urgent/ })).toBeNull();
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    expect(screen.queryByText("workItems:properties.noTransitions")).toBeNull();
  });
});
