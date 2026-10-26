import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemVersionConflictError } from "@/lib/work-item-errors";
import type { WorkItemCustomFieldColumn, WorkItemRow } from "@/types/work-item";
import WorkItemInlineFields from "./work-item-inline-fields";

const mocks = vi.hoisted(() => ({
  transition: vi.fn(),
  update: vi.fn(),
  assign: vi.fn(),
  unassign: vi.fn(),
  canUpdate: true,
  canAssign: true,
  canTransition: true,
  canSetPriority: true,
  isCheckingPermissions: false,
  transitions: [] as unknown[],
  people: [] as unknown[],
  guard: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@taskdesk/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@taskdesk/ui")>();
  return {
    ...actual,
    Calendar: ({ onSelect }: { onSelect: (day: Date) => void }) => (
      <actual.Button
        type="button"
        data-testid="inline-calendar-select"
        onClick={() => onSelect(new Date(2026, 9, 15))}
      >
        Select October 15
      </actual.Button>
    ),
  };
});
vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (value: string) =>
    value
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
}));
vi.mock("@/fetchers/work-item/transition-work-item", () => ({
  default: mocks.transition,
}));
vi.mock("@/fetchers/work-item/update-work-item", () => ({
  default: mocks.update,
}));
vi.mock("@/fetchers/work-item/assign-work-item", () => ({
  default: mocks.assign,
}));
vi.mock("@/fetchers/work-item/unassign-work-item", () => ({
  default: mocks.unassign,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: mocks.isCheckingPermissions,
    canUpdateTasks: () => mocks.canUpdate,
    canAssignTasks: () => mocks.canAssign,
    canTransitionTasks: () => mocks.canTransition,
    canSetPriorityTasks: () => mocks.canSetPriority,
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-transitions", () => ({
  default: () => ({
    data: mocks.transitions,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-assignable-people", () => ({
  default: () => ({ data: mocks.people, isLoading: false, isError: false }),
}));
vi.mock("./open-children-warning", () => ({
  isClosingCategory: (category: string) =>
    category === "completed" || category === "cancelled",
  useOpenChildrenGuard: () => ({ guard: mocks.guard, dialog: null }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function item(overrides: Partial<WorkItemRow> = {}) {
  return {
    id: "item-7",
    key: "HELP-7",
    projectId: "p1",
    workspaceId: "w1",
    stateName: "To do",
    stateCategory: "unstarted",
    title: "A work item",
    priority: "medium",
    assigneeId: null,
    assigneeName: null,
    version: 4,
    startDate: null,
    dueDate: "2026-10-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    unavailableFields: [],
    ...overrides,
  } as WorkItemRow;
}

function renderInline(
  row = item(),
  disabled = false,
  presentation: "compact" | "table" = "compact",
  customFieldColumns: WorkItemCustomFieldColumn[] = [],
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["work-items", "detail", row.key], row);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <WorkItemInlineFields
          item={row}
          disabled={disabled}
          presentation={presentation}
          customFieldColumns={customFieldColumns}
        >
          {(controls) => (
            <div>
              {controls.stateControl}
              {controls.priorityControl}
              {controls.assigneeControl}
              {controls.titleControl}
              {controls.titleEditor}
              {controls.dueDateControl}
              {Object.entries(controls.customFieldControls ?? {}).map(
                ([key, control]) => (
                  <div key={key}>{control}</div>
                ),
              )}
            </div>
          )}
        </WorkItemInlineFields>
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  for (const fn of [
    mocks.transition,
    mocks.update,
    mocks.assign,
    mocks.unassign,
  ])
    fn.mockReset().mockResolvedValue({ key: "HELP-7", version: 5 });
  mocks.canUpdate = true;
  mocks.canAssign = true;
  mocks.canTransition = true;
  mocks.canSetPriority = true;
  mocks.isCheckingPermissions = false;
  mocks.transitions = [];
  mocks.people = [];
  mocks.guard.mockReset().mockImplementation((input) => input.proceed());
});

describe("WorkItemInlineFields", () => {
  it("keeps title editing separate from detail navigation and Escape writes nothing", () => {
    const row = item();
    const { client } = renderInline(row, false, "table");

    fireEvent.click(screen.getByTestId("work-item-inline-title-edit"));
    const title = screen.getByLabelText("workItems:properties.titleLabel");
    expect(title).toHaveValue("A work item");
    fireEvent.change(title, { target: { value: "Unsaved title" } });
    fireEvent.keyDown(title, { key: "Escape" });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(screen.queryByTestId("work-item-inline-title-editor")).toBeNull();
    expect(screen.getByTestId("work-item-inline-title-edit")).toHaveFocus();
    expect(
      client.getQueryData(["work-items", "detail", row.key]),
    ).toMatchObject({
      title: "A work item",
    });
  });

  it("edits an own custom-field value with CAS and Escape/cancel never writes", async () => {
    const row = item({
      customFieldValues: { constructor: "asset-42" },
    });
    const fields: WorkItemCustomFieldColumn[] = [
      {
        key: "constructor",
        name: "Asset tag",
        format: "text",
        options: [],
      },
    ];
    renderInline(row, false, "table", fields);

    fireEvent.click(
      screen.getByTestId("work-item-inline-custom-field-edit-constructor"),
    );
    const editor = screen.getByTestId(
      "work-item-inline-custom-field-editor-constructor",
    );
    const input = editor.querySelector("input");
    expect(input).toHaveValue("asset-42");
    fireEvent.change(input as HTMLInputElement, {
      target: { value: "unsaved" },
    });
    fireEvent.keyDown(input as HTMLInputElement, { key: "Escape" });
    expect(mocks.update).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByTestId("work-item-inline-custom-field-edit-constructor"),
    );
    const reopened = screen.getByTestId(
      "work-item-inline-custom-field-editor-constructor",
    );
    const reopenedInput = reopened.querySelector("input") as HTMLInputElement;
    fireEvent.change(reopenedInput, { target: { value: "asset-43" } });
    fireEvent.click(
      screen.getByTestId("work-item-inline-custom-field-save-constructor"),
    );
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update).toHaveBeenCalledWith({
      key: "HELP-7",
      version: 4,
      customFields: { constructor: "asset-43" },
    });
  });

  it("does not expose an editor for a custom value that is absent or inherited", () => {
    const values = Object.create({
      constructor: "must-not-render",
    }) as NonNullable<WorkItemRow["customFieldValues"]>;
    renderInline(item({ customFieldValues: values }), false, "table", [
      {
        key: "constructor",
        name: "Asset tag",
        format: "text",
        options: [],
      },
    ]);
    expect(
      screen.queryByTestId("work-item-inline-custom-field-edit-constructor"),
    ).toBeNull();
    expect(screen.queryByText("must-not-render")).toBeNull();
  });

  it("saves an inline title with the latest cached version", async () => {
    const row = item({ version: 4 });
    const { client } = renderInline(row, false, "table");
    client.setQueryData(["work-items", "detail", row.key], {
      ...row,
      version: 9,
    });

    fireEvent.click(screen.getByTestId("work-item-inline-title-edit"));
    fireEvent.change(screen.getByLabelText("workItems:properties.titleLabel"), {
      target: { value: "Updated title" },
    });
    fireEvent.click(screen.getByTestId("work-item-inline-title-save"));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 9,
        title: "Updated title",
      }),
    );
  });

  it("closes a conflicted title editor and invalidates the active project list", async () => {
    mocks.update.mockRejectedValueOnce(new WorkItemVersionConflictError(4, 5));
    const row = item();
    const { client } = renderInline(row, false, "table");
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByTestId("work-item-inline-title-edit"));
    fireEvent.change(screen.getByLabelText("workItems:properties.titleLabel"), {
      target: { value: "Conflicting title" },
    });
    fireEvent.click(screen.getByTestId("work-item-inline-title-save"));

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["work-items", "p1"],
      }),
    );
    expect(screen.queryByTestId("work-item-inline-title-editor")).toBeNull();
  });

  it("uses the existing Calendar date flow and clears due date with a nullable CAS patch", async () => {
    const first = renderInline(item(), false, "table");
    fireEvent.click(screen.getByTestId("work-item-inline-due-date"));
    fireEvent.click(await screen.findByTestId("inline-calendar-select"));

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 4,
        dueDate: "2026-10-15T00:00:00.000Z",
      }),
    );

    mocks.update.mockClear();
    first.unmount();
    renderInline(item(), false, "table");
    fireEvent.click(screen.getByTestId("work-item-inline-due-date"));
    fireEvent.click(
      await screen.findByTestId("work-item-inline-due-date-clear"),
    );
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 4,
        dueDate: null,
      }),
    );
  });

  it("does not expose title or due-date editing for archived, unavailable, or denied rows", () => {
    const archived = renderInline(
      item({ archivedAt: "2026-10-01T00:00:00Z" }),
      false,
      "table",
    );
    expect(screen.queryByTestId("work-item-inline-title-edit")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-due-date")).toBeNull();
    archived.unmount();

    const unavailable = renderInline(
      item({ unavailableFields: ["title", "dueDate"] }),
      false,
      "table",
    );
    expect(screen.queryByTestId("work-item-inline-title-edit")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-due-date")).toBeNull();
    unavailable.unmount();

    mocks.canUpdate = false;
    renderInline(item(), false, "table");
    expect(screen.queryByTestId("work-item-inline-title-edit")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-due-date")).toBeNull();
  });

  it("leaves due-date editing enabled when only the title field is unavailable", () => {
    renderInline(item({ unavailableFields: ["title"] }), false, "table");

    expect(screen.queryByTestId("work-item-inline-title-edit")).toBeNull();
    expect(screen.getByTestId("work-item-inline-due-date")).toBeEnabled();
  });

  it("constrains a no-due-date trigger to its table cell and truncates its label", () => {
    renderInline(item({ dueDate: null }), false, "table");

    const trigger = screen.getByTestId("work-item-inline-due-date");
    expect(trigger).toHaveClass("w-full", "min-w-0", "max-w-full");
    expect(trigger).toHaveTextContent("workItems:list.noDueDate");
    expect(trigger.querySelector("span")).toHaveClass("min-w-0", "truncate");
  });

  it("requires the server-declared transition note before submitting", async () => {
    mocks.transitions = [
      {
        transitionId: "t-close",
        toStateTemplateId: "state-done",
        toStateName: "Done",
        toStateCategory: "completed",
        notePolicy: "required",
        available: false,
        blockedBy: [{ kind: "note", reasonCode: "note.required" }],
      },
    ];
    renderInline();

    fireEvent.click(screen.getByTestId("work-item-inline-state"));
    fireEvent.click(
      await screen.findByTestId("work-item-inline-transition-t-close"),
    );
    const submit = screen.getByRole("button", {
      name: "workItems:properties.move",
    });
    expect(submit).toBeDisabled();
    expect(mocks.transition).not.toHaveBeenCalled();

    fireEvent.change(
      screen.getByLabelText("workItems:properties.transitionNote"),
      { target: { value: "Resolved by the service desk" } },
    );
    fireEvent.click(submit);
    await waitFor(() =>
      expect(mocks.transition).toHaveBeenCalledWith({
        key: "HELP-7",
        toStateTemplateId: "state-done",
        note: "Resolved by the service desk",
      }),
    );
  });

  it("keeps blocked transitions disabled and defers a close until the child guard proceeds", async () => {
    mocks.transitions = [
      {
        transitionId: "t-blocked",
        toStateTemplateId: "state-locked",
        toStateName: "Locked",
        toStateCategory: "started",
        notePolicy: "none",
        available: false,
        blockedBy: [{ kind: "freeze", reasonCode: "change.freeze" }],
      },
      {
        transitionId: "t-close",
        toStateTemplateId: "state-done",
        toStateName: "Done",
        toStateCategory: "completed",
        notePolicy: "none",
        available: true,
        blockedBy: [],
      },
    ];
    mocks.guard.mockImplementation(() => undefined);
    renderInline();
    fireEvent.click(screen.getByTestId("work-item-inline-state"));

    expect(
      await screen.findByTestId("work-item-inline-transition-t-blocked"),
    ).toBeDisabled();
    fireEvent.click(screen.getByTestId("work-item-inline-transition-t-close"));
    expect(mocks.guard).toHaveBeenCalledWith(
      expect.objectContaining({ key: "HELP-7", closing: true }),
    );
    expect(mocks.transition).not.toHaveBeenCalled();
    mocks.guard.mock.calls[0]?.[0].proceed();
    await waitFor(() =>
      expect(mocks.transition).toHaveBeenCalledWith({
        key: "HELP-7",
        toStateTemplateId: "state-done",
      }),
    );
  });

  it("uses the current cached version for a priority change", async () => {
    const row = item({ version: 4 });
    const { client } = renderInline(row);
    client.setQueryData(["work-items", "detail", row.key], {
      ...row,
      version: 9,
    });
    fireEvent.click(screen.getByTestId("work-item-inline-priority"));
    fireEvent.click(
      await screen.findByTestId("work-item-inline-priority-option-urgent"),
    );

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        key: "HELP-7",
        version: 9,
        priority: "urgent",
      }),
    );
  });

  it("shows full table values while keeping inline controls", () => {
    renderInline(
      item({
        priority: "high",
        assigneeId: "person-1",
        assigneeName: "Casey Ray",
        assigneeActive: false,
        assigneeOnProject: true,
      }),
      false,
      "table",
    );

    expect(screen.getByTestId("work-item-inline-state")).toHaveTextContent(
      "To do",
    );
    expect(screen.getByTestId("work-item-inline-priority")).toHaveTextContent(
      "High",
    );
    expect(screen.getByTestId("work-item-inline-assignee")).toHaveTextContent(
      "Casey Ray workItems:list.assigneeInactive",
    );
  });

  it("uses the table unassigned label and returns denied fields to the caller renderer", () => {
    const first = renderInline(item(), false, "table");
    expect(screen.getByTestId("work-item-inline-assignee")).toHaveTextContent(
      "workItems:list.unassigned",
    );

    first.unmount();
    mocks.canUpdate = false;
    mocks.canAssign = false;
    mocks.canTransition = false;
    renderInline(item(), false, "table");

    expect(screen.queryByTestId("work-item-inline-state")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-priority")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-assignee")).toBeNull();
  });

  it("confirms reassignment and sends the expected current holder", async () => {
    mocks.people = [{ personId: "person-2", name: "Casey Ray" }];
    renderInline(item({ assigneeId: "person-1", assigneeName: "Riley Fox" }));

    fireEvent.click(screen.getByTestId("work-item-inline-assignee"));
    fireEvent.click(
      await screen.findByTestId("work-item-inline-assignee-option-person-2"),
    );
    expect(mocks.assign).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "workItems:journey.confirmAssignment",
      }),
    );
    await waitFor(() =>
      expect(mocks.assign).toHaveBeenCalledWith({
        key: "HELP-7",
        assigneeId: "person-2",
        expectedCurrentAssigneeId: "person-1",
      }),
    );
  });

  it("keeps all inline fields read-only for placeholder rows or denied capabilities", () => {
    const row = item({ unavailableFields: [] });
    const first = renderInline(row, true);
    expect(screen.queryByTestId("work-item-inline-state")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-priority")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-assignee")).toBeNull();
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();

    first.unmount();
    mocks.canUpdate = false;
    mocks.canAssign = false;
    mocks.canTransition = false;
    renderInline(row);
    expect(screen.queryByTestId("work-item-inline-state")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-priority")).toBeNull();
    expect(screen.queryByTestId("work-item-inline-assignee")).toBeNull();
  });
});
