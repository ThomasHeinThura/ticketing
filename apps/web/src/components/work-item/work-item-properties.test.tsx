import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemProperties from "./work-item-properties";

const mocks = vi.hoisted(() => ({
  labels: vi.fn(),
  update: vi.fn(),
  transition: vi.fn(),
  assign: vi.fn(),
  unassign: vi.fn(),
  children: vi.fn(),
  toastError: vi.fn(),
  /** The detail read the optimistic-change tests refetch through. */
  reload: vi.fn(),
  canUpdate: true,
  canAssign: true,
  canTransition: true,
  canSetPriority: true,
  transitions: [] as unknown[],
  transitionsError: null as unknown,
  people: [] as unknown[],
  peopleError: null as unknown,
  requesters: [] as unknown[],
}));

vi.mock("./work-item-actions", () => ({ default: () => null }));
vi.mock("./work-item-parent-control", () => ({
  default: () => <div data-testid="parent-control" />,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // The requester row label interpolates the person; keep the name visible to queries.
    t: (key: string, options?: { name?: string }) =>
      key === "workItems:properties.requesterValue" && options?.name
        ? `${key}: ${options.name}`
        : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/fetchers/work-item/get-work-item-labels", () => ({
  getWorkItemLabels: mocks.labels,
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
vi.mock("@/fetchers/work-item/get-hierarchy-children", () => ({
  getHierarchyChildren: mocks.children,
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

vi.mock("@/hooks/queries/work-item/use-get-requester-candidates", () => ({
  default: () => ({
    data: mocks.requesters,
    error: null,
    isError: false,
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
    requesterId: null,
    requesterName: null,
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
  mocks.labels.mockReset().mockResolvedValue([]);
  for (const fn of [
    mocks.update,
    mocks.transition,
    mocks.assign,
    mocks.unassign,
    mocks.children,
    mocks.toastError,
    mocks.reload,
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
  mocks.requesters = [];
});

describe("WorkItemProperties", () => {
  it("preserves the original property groups and labels while archived controls are disabled", async () => {
    mocks.labels.mockResolvedValue([
      { id: "label-1", name: "Support", color: "teal", assigned: true },
    ]);
    renderProps(
      <WorkItemProperties item={item()} readOnly onAccessLost={vi.fn()} />,
    );
    expect(screen.getByTestId("work-item-state-control")).toBeDisabled();
    expect(screen.getByTestId("work-item-priority-control")).toBeDisabled();
    expect(screen.getByTestId("work-item-assignee-control")).toBeDisabled();
    expect(await screen.findByText("Support")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "tasks:properties.labels" }),
    ).toBeDisabled();
    expect(screen.getByTestId("parent-control")).toBeInTheDocument();
    for (const copy of screen.getAllByRole("button", {
      name: "workItems:properties.copyLink",
    }))
      expect(copy).toBeEnabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("adds and removes a catalogue label with versioned writes", async () => {
    mocks.labels.mockResolvedValue([
      { id: "label-1", name: "Support", color: "teal", assigned: false },
    ]);
    mocks.update.mockImplementation(async (input) => {
      mocks.labels.mockResolvedValue([
        {
          id: "label-1",
          name: "Support",
          color: "teal",
          assigned: input.labelIds.length > 0,
        },
      ]);
      return { key: "HELP-7", version: input.version + 1 };
    });
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    const trigger = screen.getByRole("button", {
      name: "tasks:properties.labels",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(screen.getByTestId("work-item-labels-group")).toContainElement(
      trigger,
    );
    expect(
      screen.getByTestId("work-item-property-controls"),
    ).not.toContainElement(trigger);
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /^Support\s*settings:projectLabels\.workspaceScope$/,
      }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 4,
        labelIds: ["label-1"],
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: /^Support\s*settings:projectLabels\.workspaceScope$/,
        }),
      ).toBeChecked(),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: /^Support\s*settings:projectLabels\.workspaceScope$/,
        }),
      ).toBeEnabled(),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /^Support\s*settings:projectLabels\.workspaceScope$/,
      }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith({
        key: "HELP-7",
        version: 5,
        labelIds: [],
      }),
    );
  });

  it("distinguishes equal names in workspace and project catalogues", async () => {
    mocks.labels.mockResolvedValue([
      {
        id: "workspace-label",
        name: "Support",
        color: "teal",
        assigned: false,
        projectId: null,
      },
      {
        id: "project-label",
        name: "Support",
        color: "teal",
        assigned: false,
        projectId: "project-1",
      },
    ]);
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    const trigger = screen.getByRole("button", {
      name: "tasks:properties.labels",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    expect(
      await screen.findByRole("checkbox", {
        name: /^Support\s*settings:projectLabels\.workspaceScope$/,
      }),
    ).toBeVisible();
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /^Support\s*settings:projectLabels\.projectScope$/,
      }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 4,
        labelIds: ["project-label"],
      }),
    );
  });

  it("shows existing labels without offering edits to a read-only actor", async () => {
    mocks.canUpdate = false;
    mocks.labels.mockResolvedValue([
      { id: "label-1", name: "Support", color: "teal", assigned: true },
    ]);
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    expect(await screen.findByText("Support")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "tasks:properties.labels" }),
    ).toBeDisabled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("uses the existing conflict notice for concurrent label edits", async () => {
    mocks.labels.mockResolvedValue([
      { id: "label-1", name: "Support", color: "teal", assigned: false },
    ]);
    mocks.update.mockRejectedValue(new WorkItemVersionConflictError(4, 5));
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    const trigger = screen.getByRole("button", {
      name: "tasks:properties.labels",
    });
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: /^Support\s*settings:projectLabels\.workspaceScope$/,
      }),
    );
    expect(await screen.findByTestId("work-item-conflict")).toBeVisible();
  });

  it("saves a priority with the item's version", async () => {
    mocks.update.mockResolvedValue({});
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /High/ }));
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: /Urgent/ }),
    );
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
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Low/ }));
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
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Low/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitemradio", { name: /Urgent/ }),
      ).toBeNull(),
    );
    // The row still renders version 4 (no refetch has landed); the save must not.
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: /Urgent/ }),
    );
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[0]?.[0]).toMatchObject({ version: 4 });
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({ version: 5 });
  });

  it("re-renders with the merged cache value and keeps saving with the newest version", async () => {
    mocks.update
      .mockResolvedValueOnce({ key: "HELP-7", version: 5, priority: "low" })
      .mockResolvedValueOnce({ key: "HELP-7", version: 6, priority: "urgent" });
    const current = item();
    const { client, rerender } = renderProps(
      <WorkItemProperties item={current} onAccessLost={vi.fn()} />,
      current,
    );
    const detailKey = ["work-items", "detail", "HELP-7"];
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Low/ }));
    await waitFor(() =>
      expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
        version: 5,
        priority: "low",
      }),
    );
    const merged = client.getQueryData<WorkItemDetailRow>(
      detailKey,
    ) as WorkItemDetailRow;
    rerender(
      <QueryClientProvider client={client}>
        <WorkItemProperties item={merged} onAccessLost={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId("work-item-priority-control")).toHaveTextContent(
      "Low",
    );
    // A refetch that left before the save lands late with the old version.
    client.setQueryData(detailKey, current);
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    fireEvent.click(
      await screen.findByRole("menuitemradio", { name: /Urgent/ }),
    );
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
    expect(mocks.update.mock.calls[1]?.[0]).toMatchObject({
      version: 5,
      priority: "urgent",
    });
  });

  it("keeps priority read-only without work_item:set_priority", () => {
    mocks.canSetPriority = false;
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    expect(screen.queryByRole("menuitemradio", { name: /Urgent/ })).toBeNull();
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

  it("opens the status moves from the keyboard and moves between them with the arrow keys", async () => {
    mocks.transitions = ["In progress", "Review"].map((name, index) => ({
      transitionId: `t${index}`,
      toStateTemplateId: `tpl-${index}`,
      toStateName: name,
      notePolicy: "none",
      available: true,
      blockedBy: [],
    }));
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    const trigger = screen.getByTestId("work-item-state-control");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const first = await screen.findByRole("menuitem", { name: /In progress/ });
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: /Review/ })).toHaveFocus(),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("returns focus to the status trigger when the note popover closes", async () => {
    mocks.transitions = [
      {
        transitionId: "t-note",
        toStateTemplateId: "tpl-review",
        toStateName: "Review",
        notePolicy: "required",
        available: false,
        blockedBy: [{ reasonCode: "note.required" }],
      },
    ];
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    const trigger = screen.getByTestId("work-item-state-control");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Review/ }));
    const note = await screen.findByLabelText(
      "workItems:properties.transitionNote",
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    fireEvent.keyDown(note, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByLabelText("workItems:properties.transitionNote"),
      ).toBeNull(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
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
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /In progress/ }),
    );
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "workItems:journey.transitionUnavailable",
      ),
    );
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
    const held = await screen.findByRole("menuitem", { name: /Held/ });
    expect(held).toHaveAttribute("aria-disabled", "true");
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
    fireEvent.click(await screen.findByRole("menuitem", { name: /Review/ }));
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
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Low/ }));
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
    const blocked = await screen.findByRole("menuitem", { name: /Done/ });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    expect(blocked).toHaveTextContent(
      "workItems:journey.reasonApprovalPending",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /In progress/ }));
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
    fireEvent.click(await screen.findByRole("menuitem", { name: /Closed/ }));
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

  describe("RH-10 / WI-18: closing a parent with open children", () => {
    const openChildren = () =>
      mocks.children.mockResolvedValue({
        data: [
          {
            key: "HELP-8",
            title: "Open child",
            stateName: "In progress",
            stateCategory: "started",
          },
        ],
        progress: { total: 1, completed: 0 },
      });
    const closeOffer = (notePolicy: "none" | "required") => [
      {
        transitionId: "close",
        toStateTemplateId: "tpl-done",
        toStateName: "Done",
        toStateCategory: "completed",
        notePolicy,
        available: notePolicy === "none",
        blockedBy:
          notePolicy === "none"
            ? []
            : [{ kind: "note", reasonCode: "note.required" }],
      },
    ];

    it("lists the open children and moves only after confirming, without touching them", async () => {
      openChildren();
      mocks.transition.mockResolvedValue({});
      mocks.transitions = closeOffer("none");
      renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
      fireEvent.click(screen.getByTestId("work-item-state-control"));
      fireEvent.click(await screen.findByRole("menuitem", { name: /Done/ }));
      expect(
        await screen.findByTestId("open-children-warning"),
      ).toHaveTextContent("workItems:openChildren.item");
      expect(mocks.transition).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "workItems:openChildren.confirm" }),
      );
      await waitFor(() =>
        expect(mocks.transition.mock.calls[0]?.[0]).toEqual({
          key: "HELP-7",
          toStateTemplateId: "tpl-done",
        }),
      );
    });

    it("cancelling leaves the item where it is", async () => {
      openChildren();
      mocks.transitions = closeOffer("none");
      renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
      fireEvent.click(screen.getByTestId("work-item-state-control"));
      fireEvent.click(await screen.findByRole("menuitem", { name: /Done/ }));
      await screen.findByTestId("open-children-warning");
      fireEvent.click(
        screen.getByRole("button", { name: "common:actions.cancel" }),
      );
      await waitFor(() =>
        expect(screen.queryByTestId("open-children-warning")).toBeNull(),
      );
      expect(mocks.transition).not.toHaveBeenCalled();
    });

    it("a close that needs a note still reaches the note form after confirming", async () => {
      openChildren();
      mocks.transition.mockResolvedValue({});
      mocks.transitions = closeOffer("required");
      renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
      fireEvent.click(screen.getByTestId("work-item-state-control"));
      fireEvent.click(await screen.findByRole("menuitem", { name: /Done/ }));
      await screen.findByTestId("open-children-warning");
      fireEvent.click(
        screen.getByRole("button", { name: "workItems:openChildren.confirm" }),
      );
      expect(
        await screen.findByLabelText("workItems:properties.transitionNote"),
      ).toBeInTheDocument();
    });

    it("does not ask when nothing below is open", async () => {
      mocks.children.mockResolvedValue({
        data: [],
        progress: { total: 0, completed: 0 },
      });
      mocks.transition.mockResolvedValue({});
      mocks.transitions = closeOffer("none");
      renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
      fireEvent.click(screen.getByTestId("work-item-state-control"));
      fireEvent.click(await screen.findByRole("menuitem", { name: /Done/ }));
      await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(1));
      expect(screen.queryByTestId("open-children-warning")).toBeNull();
    });
  });

  it.each(["assign", "unassign"] as const)(
    "keeps the confirmed holder when %s waits behind another write",
    async (action) => {
      mocks.assign.mockResolvedValue({ key: "HELP-7", version: 6 });
      mocks.unassign.mockResolvedValue({ key: "HELP-7", version: 6 });
      mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
      const original = item({
        assigneeId: "person-1",
        assigneeName: "Riley Fox",
      });
      const { client } = renderProps(
        <WorkItemProperties item={original} onAccessLost={vi.fn()} />,
        original,
      );
      let release: () => void = () => {};
      const blocker = client.getMutationCache().build(client, {
        scope: { id: "work-item:HELP-7" },
        mutationFn: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      });
      const blocking = blocker.execute(undefined);
      await waitFor(() => expect(blocker.state.status).toBe("pending"));
      fireEvent.click(screen.getByRole("button", { name: /Riley Fox/ }));
      if (action === "assign") {
        fireEvent.click(
          await screen.findByRole("button", { name: /Casey Ray/ }),
        );
        fireEvent.click(
          screen.getByRole("button", {
            name: "workItems:journey.confirmAssignment",
          }),
        );
      } else {
        fireEvent.click(
          await screen.findByRole("button", {
            name: "workItems:detail.unassigned",
          }),
        );
      }
      expect(mocks.assign).not.toHaveBeenCalled();
      expect(mocks.unassign).not.toHaveBeenCalled();
      client.setQueryData(
        ["work-items", "detail", original.key],
        item({ assigneeId: "person-3", version: 5 }),
      );
      release();
      await blocking;
      if (action === "assign") {
        await waitFor(() =>
          expect(mocks.assign).toHaveBeenCalledWith({
            key: "HELP-7",
            assigneeId: "person-2",
            expectedCurrentAssigneeId: "person-1",
          }),
        );
      } else {
        await waitFor(() =>
          expect(mocks.unassign).toHaveBeenCalledWith("HELP-7", "person-1"),
        );
      }
    },
  );

  it.each([true, false])(
    "update-only caller can unassign only their own item (self: %s)",
    async (self) => {
      mocks.canAssign = false;
      mocks.people = [{ personId: "person-self", name: "Me" }];
      const current = item({
        assigneeId: self ? "person-self" : "person-other",
        assigneeName: "Holder",
      });
      renderProps(<WorkItemProperties item={current} onAccessLost={vi.fn()} />);
      fireEvent.click(screen.getByTestId("work-item-assignee-control"));
      const button = await screen.findByRole("button", {
        name: "workItems:detail.unassigned",
      });
      if (self) expect(button).toBeEnabled();
      else expect(button).toBeDisabled();
    },
  );

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

  it("names a customer as requester with the item's version, then shows the name (A-03)", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    mocks.requesters = [
      {
        personId: "cust-1",
        name: "Alice Customer",
        email: "alice@example.test",
      },
      { personId: "cust-2", name: null, email: "bob@example.test" },
    ];
    const seed = item();
    renderProps(
      <WorkItemProperties item={seed} onAccessLost={vi.fn()} />,
      seed,
    );
    const trigger = screen.getByTestId("work-item-requester-control");
    expect(trigger).toHaveTextContent("workItems:properties.noRequester");
    fireEvent.click(trigger);
    // The search narrows the organisation's customers by name or email.
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "workItems:properties.requesterSearch",
      }),
      { target: { value: "bob" } },
    );
    expect(screen.queryByRole("button", { name: /Alice Customer/ })).toBeNull();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "workItems:properties.requesterSearch",
      }),
      { target: { value: "" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Alice Customer/ }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 4,
        requesterId: "cust-1",
      }),
    );
  });

  it("clears the requester", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    renderProps(
      <WorkItemProperties
        item={item({ requesterId: "cust-1", requesterName: "Alice Customer" })}
        onAccessLost={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Alice Customer/ }));
    expect(
      await screen.findByText("workItems:properties.noCustomers"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:properties.noRequester" }),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 4,
        requesterId: null,
      }),
    );
  });

  it("shows the requester read-only without work_item:update", () => {
    mocks.canUpdate = false;
    renderProps(
      <WorkItemProperties
        item={item({ requesterId: "cust-1", requesterName: "Alice Customer" })}
        onAccessLost={vi.fn()}
      />,
    );
    const requester = screen.getByTestId("work-item-requester-control");
    // Plain text, labelled as the requester (it sits directly under Assignee).
    expect(requester).toHaveTextContent(
      "workItems:properties.requesterValue: Alice Customer",
    );
    expect(requester.tagName).toBe("DIV");
    expect(screen.queryByRole("button", { name: /Alice Customer/ })).toBeNull();
    fireEvent.click(requester);
    expect(
      screen.queryByRole("textbox", {
        name: "workItems:properties.requesterSearch",
      }),
    ).toBeNull();
  });

  it("names the editable requester row as the requester", () => {
    renderProps(
      <WorkItemProperties
        item={item({ requesterId: "cust-1", requesterName: "Alice Customer" })}
        onAccessLost={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: "workItems:properties.requesterValue: Alice Customer",
      }),
    ).toBeEnabled();
  });

  it("shows every property read-only to a role that cannot change them", () => {
    mocks.canUpdate = false;
    mocks.canAssign = false;
    mocks.canTransition = false;
    renderProps(
      <WorkItemProperties
        item={item({ dueDate: "2026-11-20T00:00:00.000Z" })}
        onAccessLost={vi.fn()}
      />,
    );
    // Read-only rows are text, not enabled buttons that do nothing: no button role, no
    // tab stop, no pointer.
    for (const control of [
      "state",
      "priority",
      "assignee",
      "requester",
      "startDate",
      "dueDate",
    ]) {
      const row = screen.getByTestId(`work-item-${control}-control`);
      expect(row.tagName).toBe("DIV");
      expect(row).not.toHaveAttribute("tabindex");
      expect(row).toHaveAttribute("data-read-only", "true");
      expect(row).toHaveClass("cursor-default");
    }
    expect(screen.queryByRole("button", { name: /High/ })).toBeNull();
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    expect(screen.queryByRole("menuitemradio", { name: /Urgent/ })).toBeNull();
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    expect(screen.queryByText("workItems:properties.noTransitions")).toBeNull();
  });

  it("keeps every property row within the strip at phone width", () => {
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    // A fieldset's UA min-inline-size is min-content; without min-w-0 the strip overflowed
    // left of the viewport beside the copy-link button at 375px.
    expect(screen.getByTestId("work-item-property-controls")).toHaveClass(
      "min-w-0",
    );
    for (const control of ["state", "priority", "assignee", "requester"]) {
      expect(screen.getByTestId(`work-item-${control}-control`)).toHaveClass(
        "min-w-0",
        "max-w-full",
      );
    }
  });
});

describe("original numbered property shortcuts", () => {
  it("uses original priority order, exposes numbered hints, ignores modified keys and submits once while pending", async () => {
    let finish: ((result: unknown) => void) | undefined;
    mocks.update.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.keyDown(document.body, { key: "5" });
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    const urgent = await screen.findByRole("menuitemradio", { name: /Urgent/ });
    expect(
      urgent.querySelector('[aria-hidden="true"]:last-child'),
    ).toHaveTextContent("5");
    fireEvent.keyDown(document.body, { key: "5", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "5", isComposing: true });
    expect(mocks.update).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "5" });
    fireEvent.keyDown(document.body, { key: "2" });
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
        key: "HELP-7",
        version: 4,
        priority: "urgent",
      }),
    );
    finish?.({ key: "HELP-7", version: 5 });
  });
  it("maps one to no priority with the current version", async () => {
    mocks.update.mockResolvedValue({ key: "HELP-7", version: 5 });
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    fireEvent.keyDown(document.body, { key: "1" });
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 4,
        priority: null,
      }),
    );
  });
  it("keeps blocked state indices fixed and opens the existing required note flow", async () => {
    mocks.transitions = [
      {
        transitionId: "blocked",
        toStateTemplateId: "blocked-template",
        toStateName: "CAB done",
        notePolicy: "none",
        available: false,
        blockedBy: [{ reasonCode: "approval.pending" }],
      },
      {
        transitionId: "note",
        toStateTemplateId: "note-template",
        toStateName: "Close with note",
        notePolicy: "required",
        available: false,
        blockedBy: [{ reasonCode: "note.required" }],
      },
    ];
    mocks.transition.mockResolvedValue({});
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    await screen.findByRole("menuitem", { name: /CAB done/ });
    fireEvent.keyDown(document.body, { key: "1" });
    expect(mocks.transition).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "2" });
    const note = screen.getByLabelText("workItems:properties.transitionNote");
    fireEvent.keyDown(document.body, { key: "2" });
    expect(mocks.transition).not.toHaveBeenCalled();
    fireEvent.change(note, { target: { value: "Actual resolution" } });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:properties.move" }),
    );
    await waitFor(() =>
      expect(mocks.transition).toHaveBeenCalledWith({
        key: "HELP-7",
        toStateTemplateId: "note-template",
        note: "Actual resolution",
      }),
    );
  });
  it("uses a permitted state offer rather than a state alias", async () => {
    mocks.transitions = [
      {
        transitionId: "edge",
        toStateTemplateId: "actual-template",
        toStateName: "Actual next",
        notePolicy: "none",
        available: true,
        blockedBy: [],
      },
    ];
    mocks.transition.mockResolvedValue({});
    renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    fireEvent.keyDown(document.body, { key: "1" });
    await waitFor(() =>
      expect(mocks.transition).toHaveBeenCalledExactlyOnceWith({
        key: "HELP-7",
        toStateTemplateId: "actual-template",
      }),
    );
  });
  it("requires holder confirmation for numbered assignment and disables numbers inside that step", async () => {
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    mocks.assign.mockResolvedValue({ key: "HELP-7", version: 5 });
    renderProps(
      <WorkItemProperties
        item={item({ assigneeId: "person-1", assigneeName: "Riley" })}
        onAccessLost={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("work-item-assignee-control"));
    fireEvent.keyDown(document.body, { key: "2" });
    const confirm = screen.getByRole("button", {
      name: "workItems:journey.confirmAssignment",
    });
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.keyDown(document.body, { key: "2" });
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.unassign).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledExactlyOnceWith({
        key: "HELP-7",
        assigneeId: "person-2",
        expectedCurrentAssigneeId: "person-1",
      }),
    );
  });
  it("does not use unassigned shortcut to clear somebody else's assignment for update-only actors", async () => {
    mocks.canAssign = false;
    mocks.people = [{ personId: "self", name: "Me" }];
    renderProps(
      <WorkItemProperties
        item={item({ assigneeId: "another", assigneeName: "Another" })}
        onAccessLost={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("work-item-assignee-control"));
    fireEvent.keyDown(document.body, { key: "1" });
    expect(mocks.unassign).not.toHaveBeenCalled();
  });
  it("cleans open shortcuts when item and project context change", async () => {
    const { client, rerender } = renderProps(
      <WorkItemProperties item={item()} onAccessLost={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("work-item-priority-control"));
    await screen.findByRole("menuitemradio", { name: /Urgent/ });
    rerender(
      <QueryClientProvider client={client}>
        <WorkItemProperties
          item={item({ key: "OTHER-1", projectId: "p2", workspaceId: "w2" })}
          onAccessLost={vi.fn()}
        />
      </QueryClientProvider>,
    );
    fireEvent.keyDown(document.body, { key: "5" });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("menuitemradio", { name: /Urgent/ }),
    ).not.toBeInTheDocument();
  });
});
it("never activates a priority shortcut without both scoped update and set-priority capabilities", () => {
  mocks.canSetPriority = false;
  renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
  fireEvent.click(screen.getByTestId("work-item-priority-control"));
  fireEvent.keyDown(document.body, { key: "5" });
  expect(mocks.update).not.toHaveBeenCalled();
});
it("maps assignment nine to the eighth actual scoped candidate", async () => {
  mocks.people = Array.from({ length: 9 }, (_, index) => ({
    personId: `person-${index + 1}`,
    name: `Person ${index + 1}`,
  }));
  mocks.assign.mockResolvedValue({ key: "HELP-7", version: 5 });
  renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
  fireEvent.click(screen.getByTestId("work-item-assignee-control"));
  fireEvent.keyDown(document.body, { key: "9" });
  await waitFor(() =>
    expect(mocks.assign).toHaveBeenCalledExactlyOnceWith({
      key: "HELP-7",
      assigneeId: "person-8",
      expectedCurrentAssigneeId: null,
    }),
  );
});

it("P6-R1-04: shows where an imported item came from with a link to the original, and nothing for a native item", () => {
  const view = renderProps(
    <WorkItemProperties
      item={item({
        importProvenance: [
          {
            system: "jira-prod",
            pluginId: "import.jira",
            sourceUrl: "https://jira.example.test/browse/HELP-7",
            importedAt: "2026-10-20T10:00:00.000Z",
            lastSeenAt: "2026-10-20T10:00:00.000Z",
            stale: false,
            sourceCreatedAt: null,
            sourceUpdatedAt: null,
            sourceResolvedAt: null,
          },
        ],
      })}
      onAccessLost={vi.fn()}
    />,
  );
  const origin = screen.getByTestId("work-item-imported-from");
  expect(origin).toHaveTextContent("workItems:properties.importedFrom");
  const link = screen.getByRole("link", {
    name: "workItems:properties.openSource",
  });
  expect(link).toHaveAttribute(
    "href",
    "https://jira.example.test/browse/HELP-7",
  );
  expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  view.unmount();

  renderProps(<WorkItemProperties item={item()} onAccessLost={vi.fn()} />);
  expect(screen.queryByTestId("work-item-import-origin")).toBeNull();
});

it("P6-R1-04: flags a stale source link and never links a non-http(s) URL", () => {
  renderProps(
    <WorkItemProperties
      item={item({
        importProvenance: [
          {
            system: "csv-export",
            pluginId: "import.csv",
            sourceUrl: "javascript:alert(1)",
            importedAt: "2026-10-20T10:00:00.000Z",
            lastSeenAt: null,
            stale: true,
            sourceCreatedAt: null,
            sourceUpdatedAt: null,
            sourceResolvedAt: null,
          },
        ],
      })}
      onAccessLost={vi.fn()}
    />,
  );
  const origin = screen.getByTestId("work-item-imported-from");
  expect(origin).toHaveAttribute("data-stale", "true");
  expect(origin).toHaveTextContent("workItems:properties.importedFromStale");
  expect(screen.queryByRole("link", { name: /openSource/ })).toBeNull();
});

// D-1: a chosen state or assignee shows at once and goes back if the server refuses.
describe("optimistic state and assignee changes", () => {
  const detailKey = ["work-items", "detail", "HELP-7"] as const;
  const projectList = ["work-items", "p1", "list", "position", "asc"] as const;

  function deferred<T = unknown>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  function liveRow(overrides: Partial<WorkItemDetailRow> = {}) {
    return item({
      number: 7,
      stateId: "state-todo",
      ...overrides,
    } as Partial<WorkItemDetailRow>);
  }

  function offer(name: string) {
    return {
      transitionId: `t-${name}`,
      toStateTemplateId: `tpl-${name}`,
      toStateId: `state-${name}`,
      toStateName: name,
      toStateCategory: "started",
      notePolicy: "none",
      available: true,
      blockedBy: [],
    };
  }

  function listData(...keys: string[]) {
    return {
      pageParams: [undefined],
      pages: [
        {
          hasMore: false,
          hasPartialFailure: false,
          items: keys.map((key) => ({
            id: `id-${key}`,
            key,
            stateId: "state-todo",
            stateName: "To do",
            stateCategory: "unstarted",
            assigneeId: null,
            assigneeName: null,
          })),
        },
      ],
    };
  }

  function listRow(client: QueryClient, queryKey: readonly unknown[]) {
    const data = client.getQueryData<ReturnType<typeof listData>>(queryKey);
    return data?.pages[0]?.items.find((row) => row.key === "HELP-7");
  }

  /** The detail the screen reads from the cache, as the work-item page does. */
  function Live({ onAccessLost }: { onAccessLost: () => void }) {
    const { data } = useQuery<WorkItemDetailRow>({
      queryKey: detailKey,
      queryFn: () => mocks.reload(),
      staleTime: Number.POSITIVE_INFINITY,
    });
    return data ? (
      <WorkItemProperties item={data} onAccessLost={onAccessLost} />
    ) : null;
  }

  function renderLive(seed: WorkItemDetailRow, onAccessLost = vi.fn()) {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    client.setQueryData(detailKey, seed);
    render(
      <QueryClientProvider client={client}>
        <Live onAccessLost={onAccessLost} />
      </QueryClientProvider>,
    );
    return client;
  }

  async function chooseState(name: RegExp) {
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    fireEvent.click(await screen.findByRole("menuitem", { name }));
  }

  it("shows the new state and closes the menu before the server answers", async () => {
    const server = deferred();
    mocks.transition.mockReturnValue(server.promise);
    mocks.reload.mockReturnValue(new Promise(() => {}));
    mocks.transitions = [offer("In progress")];
    const client = renderLive(liveRow());
    client.setQueryData(projectList, listData("HELP-7", "HELP-8"));
    await chooseState(/In progress/);
    await waitFor(() =>
      expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
        "In progress",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    // The server has not confirmed: the version is still the one it last reported.
    expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
      stateId: "state-In progress",
      stateCategory: "started",
      version: 4,
    });
    expect(listRow(client, projectList)).toMatchObject({
      stateName: "In progress",
      stateId: "state-In progress",
    });
    server.resolve({ key: "HELP-7", version: 5 });
  });

  it("does not hold the change open while the reloads run", async () => {
    mocks.transition.mockResolvedValue({
      key: "HELP-7",
      version: 5,
      stateId: "state-In progress",
    });
    const reload = deferred<WorkItemDetailRow>();
    mocks.reload.mockReturnValue(reload.promise);
    mocks.transitions = [offer("In progress")];
    const client = renderLive(liveRow());
    await chooseState(/In progress/);
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    // The refetch is still pending, yet the change has finished and the value shows.
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
      "In progress",
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("work-item-status")).toHaveTextContent(
      "workItems:journey.transitionDone",
    );
    reload.resolve(liveRow({ stateName: "In progress", version: 5 }));
  });

  it.each([
    [409, "workItems:journey.transitionConflict", "Review"],
    [403, "workItems:journey.saveError", "To do"],
    [422, "workItems:journey.transitionUnavailable", "To do"],
  ])(
    "puts the state back on a %i, explains it in a toast and shows the server's value",
    async (status, message, serverState) => {
      const server = deferred();
      mocks.transition.mockReturnValue(server.promise);
      mocks.reload.mockResolvedValue(
        liveRow({ stateName: serverState, version: 6 }),
      );
      mocks.transitions = [offer("In progress")];
      const client = renderLive(liveRow());
      client.setQueryData(projectList, listData("HELP-7"));
      await chooseState(/In progress/);
      await waitFor(() =>
        expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
          "In progress",
        ),
      );
      server.reject(new HttpError(status, "refused"));
      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(message),
      );
      await waitFor(() =>
        expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
          serverState,
        ),
      );
      expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
        stateId: "state-todo",
      });
      expect(listRow(client, projectList)).toMatchObject({
        stateName: "To do",
        stateId: "state-todo",
      });
      expect(screen.queryByRole("menu")).toBeNull();
    },
  );

  it("treats a 404 on a state change as access lost, without a toast", async () => {
    mocks.transition.mockRejectedValue(new HttpError(404, "gone"));
    mocks.reload.mockResolvedValue(liveRow());
    mocks.transitions = [offer("In progress")];
    const onAccessLost = vi.fn();
    renderLive(liveRow(), onAccessLost);
    await chooseState(/In progress/);
    await waitFor(() => expect(onAccessLost).toHaveBeenCalledTimes(1));
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
      "To do",
    );
  });

  it("leaves a note step to the server: the note popover closes, a refusal is a toast", async () => {
    const server = deferred();
    mocks.transition.mockReturnValue(server.promise);
    mocks.reload.mockResolvedValue(liveRow());
    mocks.transitions = [{ ...offer("Review"), notePolicy: "required" }];
    renderLive(liveRow());
    await chooseState(/Review/);
    fireEvent.change(
      await screen.findByLabelText("workItems:properties.transitionNote"),
      { target: { value: "Ready for review" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:properties.move" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
        "Review",
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText("workItems:properties.transitionNote"),
      ).toBeNull(),
    );
    expect(mocks.transition).toHaveBeenCalledWith({
      key: "HELP-7",
      toStateTemplateId: "tpl-Review",
      note: "Ready for review",
    });
    server.reject(new HttpError(422, "note refused"));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "workItems:journey.transitionUnavailable",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
        "To do",
      ),
    );
  });

  it("reloads only the item, its activity, its SLA and the lists that show it on a state change", async () => {
    mocks.transition.mockResolvedValue({ key: "HELP-7", version: 5 });
    mocks.reload.mockReturnValue(new Promise(() => {}));
    mocks.transitions = [offer("In progress")];
    const client = renderLive(liveRow());
    const showsItem = projectList;
    const withoutItem = ["work-items", "p1", "list", "title", "asc"] as const;
    const otherSla = ["work-items", "sla", "HELP-9"] as const;
    const labels = ["labels", "w1", "work-items", "HELP-7"] as const;
    client.setQueryData(showsItem, listData("HELP-7", "HELP-8"));
    client.setQueryData(withoutItem, listData("HELP-8"));
    client.setQueryData(otherSla, { state: "ok" });
    client.setQueryData(labels, []);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await chooseState(/In progress/);
    await waitFor(() =>
      expect(client.getQueryState(showsItem)?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(withoutItem)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherSla)?.isInvalidated).toBe(false);
    expect(client.getQueryState(labels)?.isInvalidated).toBe(false);
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["work-items", "p1"],
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["work-items", "sla"],
    });
  });

  it("shows the new assignee and closes the picker before the server answers", async () => {
    const server = deferred();
    mocks.assign.mockReturnValue(server.promise);
    mocks.reload.mockReturnValue(new Promise(() => {}));
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    const client = renderLive(liveRow());
    client.setQueryData(projectList, listData("HELP-7"));
    fireEvent.click(screen.getByTestId("work-item-assignee-control"));
    fireEvent.click(await screen.findByRole("button", { name: /Casey Ray/ }));
    await waitFor(() =>
      expect(
        screen.getByTestId("work-item-assignee-control"),
      ).toHaveTextContent("Casey Ray"),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "workItems:detail.unassigned" }),
      ).toBeNull(),
    );
    expect(mocks.assign).toHaveBeenCalledWith({
      key: "HELP-7",
      assigneeId: "person-2",
      expectedCurrentAssigneeId: null,
    });
    expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
      assigneeId: "person-2",
      assigneeName: "Casey Ray",
      version: 4,
    });
    expect(listRow(client, projectList)).toMatchObject({
      assigneeId: "person-2",
      assigneeName: "Casey Ray",
    });
    server.resolve({ key: "HELP-7", version: 5 });
  });

  it("shows an unassigned item at once and does not hold the picker for the reloads", async () => {
    mocks.unassign.mockResolvedValue({ key: "HELP-7", version: 5 });
    const reload = deferred<WorkItemDetailRow>();
    mocks.reload.mockReturnValue(reload.promise);
    mocks.people = [{ personId: "person-1", name: "Riley Fox" }];
    const client = renderLive(
      liveRow({ assigneeId: "person-1", assigneeName: "Riley Fox" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Riley Fox/ }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "workItems:detail.unassigned",
      }),
    );
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByTestId("work-item-assignee-control")).toHaveTextContent(
      "workItems:detail.unassigned",
    );
    expect(mocks.unassign).toHaveBeenCalledWith("HELP-7", "person-1");
    reload.resolve(liveRow({ version: 5 }));
  });

  it.each([
    [409, "workItems:journey.assignmentConflict"],
    [403, "workItems:journey.assignmentError"],
  ])(
    "puts the assignee back on a %i and explains it in a toast",
    async (status, message) => {
      const server = deferred();
      mocks.assign.mockReturnValue(server.promise);
      mocks.reload.mockResolvedValue(liveRow());
      mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
      const client = renderLive(liveRow());
      client.setQueryData(projectList, listData("HELP-7"));
      fireEvent.click(screen.getByTestId("work-item-assignee-control"));
      fireEvent.click(await screen.findByRole("button", { name: /Casey Ray/ }));
      await waitFor(() =>
        expect(
          screen.getByTestId("work-item-assignee-control"),
        ).toHaveTextContent("Casey Ray"),
      );
      server.reject(new HttpError(status, "refused"));
      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(message),
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("work-item-assignee-control"),
        ).toHaveTextContent("workItems:detail.unassigned"),
      );
      expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
        assigneeId: null,
        assigneeName: null,
      });
      expect(listRow(client, projectList)).toMatchObject({
        assigneeId: null,
        assigneeName: null,
      });
    },
  );

  it("keeps a newer server value when a change is refused after the cache moved on", async () => {
    const server = deferred();
    mocks.assign.mockReturnValue(server.promise);
    mocks.reload.mockResolvedValue(
      liveRow({ assigneeId: "person-3", assigneeName: "Sam Lee", version: 6 }),
    );
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    const client = renderLive(liveRow());
    fireEvent.click(screen.getByTestId("work-item-assignee-control"));
    fireEvent.click(await screen.findByRole("button", { name: /Casey Ray/ }));
    await waitFor(() =>
      expect(
        screen.getByTestId("work-item-assignee-control"),
      ).toHaveTextContent("Casey Ray"),
    );
    // A realtime refetch lands with someone else's assignment before the refusal.
    client.setQueryData(
      detailKey,
      liveRow({ assigneeId: "person-3", assigneeName: "Sam Lee", version: 6 }),
    );
    server.reject(new HttpError(409, "holder changed"));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "workItems:journey.assignmentConflict",
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("work-item-assignee-control"),
      ).toHaveTextContent("Sam Lee"),
    );
  });
});
