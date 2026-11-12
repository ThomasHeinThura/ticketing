import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useGetWorkItem from "@/hooks/queries/work-item/use-get-work-item";
import useGetWorkItems from "@/hooks/queries/work-item/use-get-work-items";
import { HttpError } from "@/lib/http-error";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import { WorkItemTransitionBlockedError } from "@/lib/work-item-transition-reasons";
import type { WorkItemDetailRow } from "@/types/work-item";
import WorkItemProperties from "./work-item-properties";

const mocks = vi.hoisted(() => ({
  labels: vi.fn(),
  update: vi.fn(),
  transition: vi.fn(),
  assign: vi.fn(),
  unassign: vi.fn(),
  children: vi.fn(),
  getWorkItem: vi.fn(),
  getWorkItems: vi.fn(),
  toastError: vi.fn(),
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
    // Keep interpolated names/reasons visible to queries and toast assertions.
    t: (key: string, options?: { name?: string; reason?: string }) =>
      key === "workItems:properties.requesterValue" && options?.name
        ? `${key}: ${options.name}`
        : key === "workItems:board.transitionBlocked" && options?.reason
          ? `${key}: ${options.reason}`
          : key,
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/fetchers/work-item/get-work-item-labels", () => ({
  getWorkItemLabels: mocks.labels,
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: mocks.getWorkItem,
}));
vi.mock("@/fetchers/work-item/get-work-items", () => ({
  default: mocks.getWorkItems,
}));
vi.mock("@/hooks/use-native-work-item-realtime", () => ({
  useNativeWorkItemRealtime: () => ({
    status: "available",
    isUnavailable: false,
  }),
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
    mocks.getWorkItem,
    mocks.getWorkItems,
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

describe("optimistic state and assignee changes", () => {
  const detailKey = ["work-items", "detail", "HELP-7"] as const;
  const projectList = ["work-items", "p1", "list", "key", "desc"] as const;
  const boardList = ["work-items", "p1", "board", "position", "asc"] as const;

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
      id: "id-HELP-7",
      number: 7,
      title: "Fix printer",
      stateId: "state-todo",
      assigneeActive: null,
      assigneeOnProject: null,
      createdAt: "2026-11-12T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
      ...overrides,
    } as Partial<WorkItemDetailRow>);
  }

  function offer(
    name: string,
    category: WorkItemDetailRow["stateCategory"] = "started",
  ) {
    return {
      transitionId: `t-${name}`,
      toStateTemplateId: `tpl-${name}`,
      toStateId: `state-${name}`,
      toStateName: name,
      toStateCategory: category,
      notePolicy: "none",
      available: true,
      blockedBy: [],
    };
  }

  function listPage(
    rows: Array<Record<string, unknown>>,
    extraKeys: string[] = [],
  ) {
    return {
      hasMore: false,
      hasPartialFailure: false,
      items: [
        ...rows,
        ...extraKeys.map((key) => ({
          id: `id-${key}`,
          key,
          version: 4,
          stateId: "state-todo",
          stateName: "To do",
          stateCategory: "unstarted",
          assigneeId: null,
          assigneeName: null,
          unavailableFields: [],
        })),
      ],
    };
  }

  function listData(
    seedRow: WorkItemDetailRow = liveRow(),
    ...extraKeys: string[]
  ) {
    return {
      pageParams: [undefined],
      pages: [
        listPage(
          [
            {
              id: "id-HELP-7",
              key: seedRow.key,
              version: seedRow.version,
              stateId: "state-todo",
              stateName: seedRow.stateName,
              stateCategory: seedRow.stateCategory,
              assigneeId: seedRow.assigneeId,
              assigneeName: seedRow.assigneeName,
              assigneeActive: seedRow.assigneeActive ?? null,
              assigneeOnProject: seedRow.assigneeOnProject ?? null,
              unavailableFields: [],
            },
          ],
          extraKeys,
        ),
      ],
    };
  }

  function listRow(
    client: QueryClient,
    queryKey: readonly unknown[] = projectList,
  ) {
    const data = client.getQueryData<{
      pages: Array<{ items: Array<Record<string, unknown>> }>;
    }>(queryKey);
    return data?.pages[0]?.items.find((row) => row.key === "HELP-7");
  }

  function LiveHarness({ onAccessLost }: { onAccessLost: () => void }) {
    const detail = useGetWorkItem({ key: "HELP-7" });
    const list = useGetWorkItems({
      projectId: "p1",
      sort: "key",
      dir: "desc",
      realtimeStatus: "available",
    });
    const listedRow = list.data?.items.find((row) => row.key === "HELP-7");
    return (
      <>
        {detail.data ? (
          <WorkItemProperties item={detail.data} onAccessLost={onAccessLost} />
        ) : null}
        <output data-testid="live-list-state">
          {listedRow
            ? `${listedRow.stateName}|${listedRow.assigneeName ?? "unassigned"}`
            : "missing"}
        </output>
      </>
    );
  }

  function renderLive(seed = liveRow(), onAccessLost = vi.fn()) {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
        },
        mutations: { retry: false },
      },
    });
    client.setQueryData(detailKey, seed);
    client.setQueryData(projectList, listData(seed));
    render(
      <QueryClientProvider client={client}>
        <LiveHarness onAccessLost={onAccessLost} />
      </QueryClientProvider>,
    );
    return client;
  }

  async function chooseState(label: RegExp) {
    fireEvent.click(screen.getByTestId("work-item-state-control"));
    fireEvent.click(await screen.findByRole("menuitem", { name: label }));
  }

  async function chooseAssignee(label: RegExp, confirm = false) {
    fireEvent.click(screen.getByTestId("work-item-assignee-control"));
    fireEvent.click(await screen.findByRole("button", { name: label }));
    if (confirm) {
      fireEvent.click(
        await screen.findByRole("button", {
          name: "workItems:journey.confirmAssignment",
        }),
      );
    }
  }

  it("shows the new state and closes the menu before the server answers without touching board caches", async () => {
    const server = deferred();
    mocks.transition.mockReturnValue(server.promise);
    mocks.getWorkItem.mockReturnValue(new Promise(() => {}));
    mocks.getWorkItems.mockReturnValue(new Promise(() => {}));
    mocks.transitions = [offer("In progress")];
    const client = renderLive();
    client.setQueryData(boardList, listData());

    await chooseState(/In progress/);

    await waitFor(() =>
      expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
        "In progress",
      ),
    );
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByTestId("live-list-state")).toHaveTextContent(
      "In progress|unassigned",
    );
    expect(listRow(client, boardList)?.stateName).toBe("To do");
    server.resolve({ key: "HELP-7", stateId: "state-in-progress", version: 5 });
  });

  it("closes the note popover at once and surfaces guard reason codes in a toast on refusal", async () => {
    const server = deferred();
    mocks.transition.mockReturnValue(server.promise);
    mocks.getWorkItem.mockResolvedValue(liveRow());
    mocks.getWorkItems.mockResolvedValue(listPage(listData().pages[0].items));
    mocks.transitions = [
      {
        ...offer("Review"),
        notePolicy: "required",
        available: false,
        blockedBy: [{ reasonCode: "note.required" }],
      },
    ];
    renderLive();

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
    expect(
      screen.queryByLabelText("workItems:properties.transitionNote"),
    ).toBeNull();

    server.reject(new WorkItemTransitionBlockedError(["approval.pending"]));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "workItems:board.transitionBlocked: workItems:journey.reasonApprovalPending",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
        "To do",
      ),
    );
    expect(screen.getByTestId("live-list-state")).toHaveTextContent(
      "To do|unassigned",
    );
  });

  it("shows the new assignee and closes the picker before the server answers, and does not await reloads on unassign", async () => {
    const assignReq = deferred();
    mocks.assign.mockReturnValueOnce(assignReq.promise);
    const reloadDetail = deferred<WorkItemDetailRow>();
    mocks.getWorkItem.mockReturnValue(reloadDetail.promise);
    mocks.getWorkItems.mockReturnValue(new Promise(() => {}));
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    const client = renderLive();

    await chooseAssignee(/Casey Ray/);

    await waitFor(() =>
      expect(
        screen.getByTestId("work-item-assignee-control"),
      ).toHaveTextContent("Casey Ray"),
    );
    expect(
      screen.queryByRole("button", { name: "workItems:detail.unassigned" }),
    ).toBeNull();
    expect(screen.getByTestId("live-list-state")).toHaveTextContent(
      "To do|Casey Ray",
    );
    assignReq.resolve({ key: "HELP-7", version: 5 });
    await waitFor(() => expect(client.isMutating()).toBe(0));

    mocks.unassign.mockResolvedValueOnce({ key: "HELP-7", version: 6 });
    fireEvent.click(screen.getByTestId("work-item-assignee-control"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "workItems:detail.unassigned",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("work-item-assignee-control"),
      ).toHaveTextContent("workItems:detail.unassigned"),
    );
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(mocks.unassign).toHaveBeenCalledWith("HELP-7", "person-2");
    reloadDetail.resolve(liveRow({ version: 6 }));
  });

  it.each([
    [
      "409",
      new HttpError(409, "conflict"),
      "workItems:journey.transitionConflict",
      "Done",
      6,
    ],
    [
      "403",
      new HttpError(403, "forbidden"),
      "workItems:journey.transitionForbidden",
      "To do",
      4,
    ],
    [
      "network",
      new TypeError("Failed to fetch"),
      "workItems:journey.saveError",
      "To do",
      4,
    ],
  ])(
    "rolls back state on %s with a translated toast and applies fresh server state on 409",
    async (_kind, failure, toastKey, expectedState, serverVersion) => {
      const server = deferred();
      mocks.transition.mockReturnValue(server.promise);
      const serverRow = liveRow({
        stateName: expectedState,
        version: serverVersion,
      });
      mocks.getWorkItem.mockImplementation(async () => {
        if (failure instanceof TypeError) throw failure;
        return serverRow;
      });
      mocks.getWorkItems.mockImplementation(async () => {
        if (failure instanceof TypeError) throw failure;
        return listData(serverRow).pages[0];
      });
      mocks.transitions = [offer("In progress")];
      const client = renderLive();

      await chooseState(/In progress/);
      await waitFor(() =>
        expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
          "In progress",
        ),
      );

      server.reject(failure);
      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(toastKey),
      );
      await waitFor(() =>
        expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
          expectedState,
        ),
      );
      expect(client.getQueryData<WorkItemDetailRow>(detailKey)?.stateName).toBe(
        expectedState,
      );
      expect(listRow(client)?.stateName).toBe(expectedState);
    },
  );

  it.each([
    [
      "409",
      new HttpError(409, "conflict"),
      "workItems:journey.assignmentConflict",
      "Sam Lee",
      "person-3",
      6,
    ],
    [
      "403",
      new HttpError(403, "forbidden"),
      "workItems:journey.assignmentForbidden",
      null,
      null,
      4,
    ],
    [
      "network",
      new TypeError("Failed to fetch"),
      "workItems:journey.assignmentError",
      null,
      null,
      4,
    ],
  ])(
    "rolls back assignee on %s with a translated toast and applies fresh server assignee on 409",
    async (_kind, failure, toastKey, expectedName, expectedId, serverVersion) => {
      const server = deferred();
      mocks.assign.mockReturnValue(server.promise);
      const serverRow = liveRow({
        assigneeId: expectedId,
        assigneeName: expectedName,
        assigneeActive: expectedId ? true : null,
        assigneeOnProject: expectedId ? true : null,
        version: serverVersion,
      });
      mocks.getWorkItem.mockImplementation(async () => {
        if (failure instanceof TypeError) throw failure;
        return serverRow;
      });
      mocks.getWorkItems.mockImplementation(async () => {
        if (failure instanceof TypeError) throw failure;
        return listData(serverRow).pages[0];
      });
      mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
      const client = renderLive();

      await chooseAssignee(/Casey Ray/);
      await waitFor(() =>
        expect(
          screen.getByTestId("work-item-assignee-control"),
        ).toHaveTextContent("Casey Ray"),
      );

      server.reject(failure);
      await waitFor(() =>
        expect(mocks.toastError).toHaveBeenCalledWith(toastKey),
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("work-item-assignee-control"),
        ).toHaveTextContent(expectedName ?? "workItems:detail.unassigned"),
      );
      expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
        assigneeId: expectedId,
        assigneeName: expectedName,
      });
      expect(listRow(client)).toMatchObject({
        assigneeId: expectedId,
        assigneeName: expectedName,
      });
    },
  );

  it.each([
    ["first-refused-second-succeeds", "Review", "started"],
    ["first-succeeds-second-refused", "In progress", "started"],
    ["both-refused", "To do", "unstarted"],
  ] as const)(
    "serialises two quick state changes (%s) to the right detail and list state without relying on a repair GET",
    async (scenario, finalState, finalCategory) => {
      const first = deferred();
      const second = deferred();
      mocks.transition
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      mocks.getWorkItem.mockRejectedValue(new TypeError("offline"));
      mocks.getWorkItems.mockRejectedValue(new TypeError("offline"));
      mocks.transitions = [
        offer("In progress", "started"),
        offer("Review", "started"),
      ];
      const client = renderLive();

      await chooseState(/In progress/);
      await chooseState(/Review/);

      await waitFor(() =>
        expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
          "Review",
        ),
      );
      expect(screen.getByTestId("live-list-state")).toHaveTextContent(
        "Review|unassigned",
      );
      // Serialised scope: the second POST has not fired while the first is in flight.
      expect(mocks.transition).toHaveBeenCalledTimes(1);

      if (scenario === "first-refused-second-succeeds") {
        first.reject(new HttpError(403, "denied"));
        await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(2));
        expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
          "Review",
        );
        second.resolve({ key: "HELP-7", stateId: "state-review", version: 5 });
      } else if (scenario === "first-succeeds-second-refused") {
        first.resolve({
          key: "HELP-7",
          stateId: "state-in-progress",
          version: 5,
        });
        await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(2));
        second.reject(new HttpError(403, "denied"));
      } else {
        first.reject(new HttpError(403, "denied"));
        await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(2));
        second.reject(new HttpError(403, "denied"));
      }

      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
        finalState,
      );
      expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
        stateName: finalState,
        stateCategory: finalCategory,
      });
      expect(listRow(client)).toMatchObject({
        stateName: finalState,
        stateCategory: finalCategory,
      });
    },
  );

  it.each([
    [
      "first-refused-second-succeeds",
      "person-2",
      "Casey Ray",
      true,
      "Casey Ray",
    ],
    [
      "first-succeeds-second-refused",
      "person-1",
      "Riley Fox",
      true,
      "Riley Fox",
    ],
    [
      "both-refused",
      "person-0",
      "Jane Smith",
      false,
      "Jane Smith workItems:detail.inactiveAssignee",
    ],
  ] as const)(
    "serialises two quick assignee changes (%s) to the right detail and list state without leaking inactive flags or relying on a repair GET",
    async (scenario, finalId, finalName, finalActive, expectedButtonLabel) => {
      const first = deferred();
      const second = deferred();
      mocks.assign
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      mocks.getWorkItem.mockRejectedValue(new TypeError("offline"));
      mocks.getWorkItems.mockRejectedValue(new TypeError("offline"));
      mocks.people = [
        { personId: "person-1", name: "Riley Fox" },
        { personId: "person-2", name: "Casey Ray" },
      ];
      const seed = liveRow({
        assigneeId: "person-0",
        assigneeName: "Jane Smith",
        assigneeActive: false,
        assigneeOnProject: true,
      });
      const client = renderLive(seed);

      await chooseAssignee(/Riley Fox/, true);
      await chooseAssignee(/Casey Ray/, true);

      await waitFor(() =>
        expect(
          screen.getByTestId("work-item-assignee-control"),
        ).toHaveTextContent("Casey Ray"),
      );
      expect(mocks.assign).toHaveBeenCalledTimes(1);

      if (scenario === "first-refused-second-succeeds") {
        first.reject(new HttpError(403, "denied"));
        await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
        // Because Riley Fox was refused, Casey Ray rebases expectedCurrentAssigneeId to person-0.
        expect(mocks.assign.mock.calls[1]?.[0]).toEqual({
          key: "HELP-7",
          assigneeId: "person-2",
          expectedCurrentAssigneeId: "person-0",
        });
        second.resolve({ key: "HELP-7", version: 5 });
      } else if (scenario === "first-succeeds-second-refused") {
        first.resolve({ key: "HELP-7", version: 5 });
        await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
        expect(mocks.assign.mock.calls[1]?.[0]).toEqual({
          key: "HELP-7",
          assigneeId: "person-2",
          expectedCurrentAssigneeId: "person-1",
        });
        second.reject(new HttpError(403, "denied"));
      } else {
        first.reject(new HttpError(403, "denied"));
        await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
        second.reject(new HttpError(403, "denied"));
      }

      await waitFor(() => expect(client.isMutating()).toBe(0));
      expect(
        screen.getByTestId("work-item-assignee-control"),
      ).toHaveTextContent(expectedButtonLabel);
      expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
        assigneeId: finalId,
        assigneeName: finalName,
        assigneeActive: finalActive,
      });
      expect(listRow(client)).toMatchObject({
        assigneeId: finalId,
        assigneeName: finalName,
        assigneeActive: finalActive,
      });
    },
  );

  it("keeps a concurrent change to another field intact when the first field is refused", async () => {
    const stateWrite = deferred();
    const assignWrite = deferred();
    mocks.transition.mockReturnValue(stateWrite.promise);
    mocks.assign.mockReturnValue(assignWrite.promise);
    mocks.getWorkItem.mockRejectedValue(new TypeError("offline"));
    mocks.getWorkItems.mockRejectedValue(new TypeError("offline"));
    mocks.transitions = [offer("In progress")];
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    const client = renderLive();

    await chooseState(/In progress/);
    await chooseAssignee(/Casey Ray/);

    await waitFor(() => {
      expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
        "In progress",
      );
      expect(
        screen.getByTestId("work-item-assignee-control"),
      ).toHaveTextContent("Casey Ray");
    });
    expect(mocks.transition).toHaveBeenCalledTimes(1);
    expect(mocks.assign).not.toHaveBeenCalled();

    stateWrite.reject(new HttpError(403, "state denied"));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
      "To do",
    );
    expect(screen.getByTestId("work-item-assignee-control")).toHaveTextContent(
      "Casey Ray",
    );

    assignWrite.resolve({ key: "HELP-7", version: 5 });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
      stateName: "To do",
      assigneeId: "person-2",
      assigneeName: "Casey Ray",
      version: 5,
    });
    expect(listRow(client)).toMatchObject({
      stateName: "To do",
      assigneeId: "person-2",
      assigneeName: "Casey Ray",
      version: 5,
    });
  });

  it("prevents an older detail or list read arriving late from overwriting a newer optimistic or confirmed value", async () => {
    const stateWrite = deferred();
    mocks.transition.mockReturnValue(stateWrite.promise);
    mocks.transitions = [offer("In progress")];
    const client = renderLive();

    await chooseState(/In progress/);
    await waitFor(() =>
      expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
        "In progress",
      ),
    );

    // Late version-4 reads arrive while the optimistic write is in flight.
    mocks.getWorkItem.mockResolvedValueOnce(
      liveRow({ stateName: "To do", version: 4 }),
    );
    mocks.getWorkItems.mockResolvedValueOnce(
      listData(liveRow({ stateName: "To do", version: 4 })).pages[0],
    );
    await client.refetchQueries({ queryKey: detailKey });
    await client.refetchQueries({ queryKey: projectList, exact: true });
    expect(screen.getByTestId("work-item-state-control")).toHaveTextContent(
      "In progress",
    );
    expect(listRow(client)?.stateName).toBe("In progress");

    // Settle refetch returns version 5; a subsequent out-of-order version-4 read still loses.
    const confirmed = liveRow({
      stateName: "In progress",
      stateCategory: "started",
      version: 5,
    });
    mocks.getWorkItem.mockResolvedValueOnce(confirmed);
    mocks.getWorkItems.mockResolvedValueOnce(listData(confirmed).pages[0]);
    stateWrite.resolve({ key: "HELP-7", version: 5 });
    await waitFor(() => expect(client.isMutating()).toBe(0));

    mocks.getWorkItem.mockResolvedValueOnce(
      liveRow({ stateName: "To do", version: 4 }),
    );
    mocks.getWorkItems.mockResolvedValueOnce(
      listData(liveRow({ stateName: "To do", version: 4 })).pages[0],
    );
    await client.refetchQueries({ queryKey: detailKey });
    await client.refetchQueries({ queryKey: projectList, exact: true });
    expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
      stateName: "In progress",
      version: 5,
    });
    expect(listRow(client)).toMatchObject({
      stateName: "In progress",
      version: 5,
    });
  });

  it("restores the confirmed version-5 assignee when a second assignee write fails while another field stays pending, even after an older version-4 read", async () => {
    const firstAssign = deferred();
    const stateWrite = deferred();
    const secondAssign = deferred();
    mocks.assign
      .mockReturnValueOnce(firstAssign.promise)
      .mockReturnValueOnce(secondAssign.promise);
    mocks.transition.mockReturnValueOnce(stateWrite.promise);
    mocks.transitions = [offer("In progress")];
    mocks.people = [
      { personId: "person-1", name: "Riley Fox" },
      { personId: "person-2", name: "Casey Ray" },
    ];
    const client = renderLive();

    // Queue assignee #1 (Riley Fox) then state (In progress).
    await chooseAssignee(/Riley Fox/);
    await chooseState(/In progress/);

    // Assignee #1 succeeds at version 5; state write is now in flight and keeps item mutating.
    firstAssign.resolve({ key: "HELP-7", version: 5 });
    await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(1));

    // An older version-4 read lands while state is still pending.
    mocks.getWorkItem.mockResolvedValueOnce(liveRow({ version: 4 }));
    mocks.getWorkItems.mockResolvedValueOnce(
      listData(liveRow({ version: 4 })).pages[0],
    );
    await client.refetchQueries({ queryKey: detailKey });
    await client.refetchQueries({ queryKey: projectList, exact: true });

    // Start a second assignee write (Casey Ray) while state is still pending.
    await chooseAssignee(/Casey Ray/, true);
    await waitFor(() =>
      expect(
        screen.getByTestId("work-item-assignee-control"),
      ).toHaveTextContent("Casey Ray"),
    );

    // State finishes at version 6, then assignee #2 is refused without a successful repair GET.
    mocks.getWorkItem.mockRejectedValue(new TypeError("offline"));
    mocks.getWorkItems.mockRejectedValue(new TypeError("offline"));
    stateWrite.resolve({ key: "HELP-7", version: 6 });
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
    expect(mocks.assign.mock.calls[1]?.[0]).toEqual({
      key: "HELP-7",
      assigneeId: "person-2",
      expectedCurrentAssigneeId: "person-1",
    });
    secondAssign.reject(new HttpError(403, "denied"));

    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(screen.getByTestId("work-item-assignee-control")).toHaveTextContent(
      "Riley Fox",
    );
    expect(client.getQueryData<WorkItemDetailRow>(detailKey)).toMatchObject({
      assigneeId: "person-1",
      assigneeName: "Riley Fox",
      stateName: "In progress",
      version: 6,
    });
    expect(listRow(client)).toMatchObject({
      assigneeId: "person-1",
      assigneeName: "Riley Fox",
      stateName: "In progress",
      version: 6,
    });
  });

  it("invalidates only the item, its activity, its transitions, its SLA and lists showing it — never the whole project prefix", async () => {
    mocks.transition.mockResolvedValue({ key: "HELP-7", version: 5 });
    mocks.getWorkItem.mockReturnValue(new Promise(() => {}));
    mocks.getWorkItems.mockReturnValue(new Promise(() => {}));
    mocks.transitions = [offer("In progress")];
    const client = renderLive();
    const withoutItem = ["work-items", "p1", "list", "title", "asc"] as const;
    const otherSla = ["work-items", "sla", "HELP-9"] as const;
    const itemSla = ["work-items", "sla", "HELP-7"] as const;
    const itemActivity = ["work-items", "activity", "HELP-7"] as const;
    const labels = ["labels", "w1", "work-items", "HELP-7"] as const;
    client.setQueryData(withoutItem, {
      pageParams: [undefined],
      pages: [listPage([], ["HELP-8"])],
    });
    client.setQueryData(otherSla, { state: "ok" });
    client.setQueryData(itemSla, { state: "ok" });
    client.setQueryData(itemActivity, []);
    client.setQueryData(labels, []);
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await chooseState(/In progress/);
    await waitFor(() =>
      expect(client.getQueryState(projectList)?.isInvalidated).toBe(true),
    );
    expect(client.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(itemActivity)?.isInvalidated).toBe(true);
    expect(client.getQueryState(itemSla)?.isInvalidated).toBe(true);
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

  it("fires exactly one settle refetch after a burst of queued changes", async () => {
    const firstState = deferred();
    const secondState = deferred();
    const assignWrite = deferred();
    mocks.transition
      .mockReturnValueOnce(firstState.promise)
      .mockReturnValueOnce(secondState.promise);
    mocks.assign.mockReturnValueOnce(assignWrite.promise);
    const finalRow = liveRow({
      stateName: "Review",
      stateCategory: "started",
      assigneeId: "person-2",
      assigneeName: "Casey Ray",
      assigneeActive: true,
      assigneeOnProject: true,
      version: 7,
    });
    mocks.getWorkItem.mockResolvedValue(finalRow);
    mocks.getWorkItems.mockResolvedValue(listData(finalRow).pages[0]);
    mocks.transitions = [offer("In progress"), offer("Review")];
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    const client = renderLive();

    await chooseState(/In progress/);
    await chooseState(/Review/);
    await chooseAssignee(/Casey Ray/);

    firstState.resolve({ key: "HELP-7", version: 5 });
    await waitFor(() => expect(mocks.transition).toHaveBeenCalledTimes(2));
    expect(mocks.getWorkItem).not.toHaveBeenCalled();
    expect(mocks.getWorkItems).not.toHaveBeenCalled();

    secondState.resolve({ key: "HELP-7", version: 6 });
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(1));
    expect(mocks.getWorkItem).not.toHaveBeenCalled();
    expect(mocks.getWorkItems).not.toHaveBeenCalled();

    assignWrite.resolve({ key: "HELP-7", version: 7 });
    await waitFor(() => expect(client.isMutating()).toBe(0));
    await waitFor(() => expect(mocks.getWorkItem).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.getWorkItems).toHaveBeenCalledTimes(1));
    expect(mocks.getWorkItem).toHaveBeenCalledTimes(1);
    expect(mocks.getWorkItems).toHaveBeenCalledTimes(1);
  });
});
