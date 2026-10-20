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
  transitions: [] as unknown[],
  people: [] as unknown[],
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
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-transitions", () => ({
  default: () => ({ data: mocks.transitions, isLoading: false }),
}));
vi.mock("@/hooks/queries/work-item/use-get-assignable-people", () => ({
  default: () => ({ data: mocks.people, isLoading: false }),
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

function renderProps(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
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
  mocks.transitions = [];
  mocks.people = [];
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

  it("explains a version conflict and does not lose the user's place", async () => {
    mocks.update.mockRejectedValue(new WorkItemVersionConflictError(4, 5));
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Low/ }));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "workItems:properties.conflict",
      ),
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

  it("assigns with the holder the screen showed, and unassigns the same way", async () => {
    mocks.assign.mockResolvedValue({});
    mocks.unassign.mockResolvedValue({});
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    renderProps(
      <WorkItemProperties
        item={item({ assigneeId: "person-1", assigneeName: "Riley Fox" })}
        onAccessLost={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Riley Fox/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Casey Ray/ }));
    await waitFor(() =>
      expect(mocks.assign.mock.calls[0]?.[0]).toEqual({
        key: "HELP-7",
        assigneeId: "person-2",
        expectedCurrentAssigneeId: "person-1",
      }),
    );
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
