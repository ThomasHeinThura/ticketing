import { Dialog, DialogContent, Input, Textarea } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import CreateWorkItemDialogForm from "./create-work-item-dialog-form";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  refetchTypes: vi.fn(),
  lastCreateInput: undefined as unknown,
  editorDocument: undefined as unknown,
  isPending: false,
  canCreate: true,
  canUpdate: true,
  canAssign: true,
  canManageLabels: false,
  canAttach: true,
  uploadAttachment: vi.fn(),
  createLabel: vi.fn(),
  options: {
    states: [
      {
        id: "s-1",
        stateTemplateId: "st-1",
        name: "Backlog",
        group: "backlog",
        position: 0,
        isDefault: true,
      },
    ],
    people: [
      {
        personId: "person-1",
        name: "Ada Agent",
        roleName: "Agent",
        openWorkCount: 1,
      },
    ],
    labels: [
      {
        id: "label-1",
        name: "Release",
        color: "teal",
        workspaceId: "ws-1",
        taskId: null,
        projectId: null,
      },
    ],
    statesLoading: false,
    statesError: false,
    peopleLoading: false,
    peopleError: false,
    labelsLoading: false,
    labelsError: false,
  },
  templates: [] as Array<Record<string, unknown>>,
  customFields: [] as Array<Record<string, unknown>>,
  typesState: {
    data: undefined as Array<Record<string, unknown>> | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    isCheckingPermissions: false,
    canCreateTasks: () => mocks.canCreate,
    canUpdateTasks: () => mocks.canUpdate,
    canAssignTasks: () => mocks.canAssign,
    canManageLabels: () => mocks.canManageLabels,
    canCreateAttachments: () => mocks.canAttach,
  }),
}));
vi.mock("@/fetchers/attachment/work-item-attachments", () => ({
  resumeWorkItemAttachment: mocks.uploadAttachment,
}));
vi.mock("./use-create-work-item-options", () => ({
  useCreateWorkItemOptions: () => mocks.options,
}));

vi.mock("@/hooks/mutations/label/use-create-label", () => ({
  default: () => ({ mutateAsync: mocks.createLabel }),
}));
vi.mock("@/components/activity/comment-editor", () => ({
  default: ({
    value,
    onContentChange,
    disabled,
    onFilesSelected,
  }: {
    value: string;
    onContentChange: (snapshot: { text: string; document: unknown }) => void;
    disabled?: boolean;
    onFilesSelected?: (files: File[]) => void;
  }) => (
    <>
      <Textarea
        data-testid="create-work-item-description"
        value={value}
        disabled={disabled}
        onChange={(event) =>
          onContentChange({
            text: event.target.value,
            document: mocks.editorDocument ?? {
              type: "doc",
              content: event.target.value.split("\n").map((text) => ({
                type: "paragraph",
                content: [{ type: "text", text }],
              })),
            },
          })
        }
      />
      {onFilesSelected ? (
        <Input
          data-testid="stage-files"
          type="file"
          multiple
          onChange={(event) =>
            onFilesSelected(Array.from(event.target.files ?? []))
          }
        />
      ) : null}
    </>
  ),
}));
vi.mock(
  "@/hooks/queries/work-item-template/use-work-item-template-options",
  () => ({
    default: () => ({ data: mocks.templates }),
  }),
);
vi.mock("@/hooks/queries/custom-field/use-custom-fields", () => ({
  useCustomFields: () => ({
    data: { data: mocks.customFields, meta: { total: 0 } },
  }),
}));
vi.mock("@/hooks/queries/work-item/use-get-work-item-types", () => ({
  default: () => mocks.typesState,
}));

vi.mock("@/hooks/mutations/work-item/use-create-work-item", () => ({
  default: (input: unknown) => {
    mocks.lastCreateInput = input;
    return {
      // Capture the input as it was on the render this call came from -- the component
      // resets its state on success, so reading `lastCreateInput` after the flow
      // finishes would see the reset values, not the submitted ones.
      mutateAsync: (...args: unknown[]) =>
        mocks.mutateAsync(mocks.lastCreateInput, ...args),
      isPending: mocks.isPending,
    };
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.toastSuccess, error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const TYPES = [
  { id: "type-1", key: "task", name: "Task" },
  { id: "type-2", key: "bug", name: "Bug" },
];

/**
 * Base UI's `Select.Item` selects on the pointer sequence, not on a bare
 * `click` -- a lone `fireEvent.click` opens and highlights but never commits
 * (verified in this file's environment: the popup stays open and
 * `onValueChange` never fires). Dispatch the same sequence a real pointer
 * produces.
 */
function pickOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.pointerUp(option);
  fireEvent.click(option);
}

function renderDialog(onClose = vi.fn()) {
  render(
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        data-testid="create-work-item-dialog"
      >
        <CreateWorkItemDialogForm
          onClose={onClose}
          projectId="proj-1"
          workspaceId="ws-1"
        />
      </DialogContent>
    </Dialog>,
  );
  return onClose;
}

beforeEach(() => {
  mocks.mutateAsync.mockReset();
  mocks.invalidateQueries.mockReset();
  mocks.toastSuccess.mockReset();
  mocks.refetchTypes.mockReset();
  mocks.isPending = false;
  mocks.canCreate = true;
  mocks.canUpdate = true;
  mocks.canAssign = true;
  mocks.canManageLabels = false;
  mocks.canAttach = true;
  mocks.uploadAttachment.mockReset();
  mocks.createLabel.mockReset();
  mocks.options.peopleError = false;
  mocks.options.labelsError = false;
  mocks.editorDocument = undefined;
  mocks.templates = [];
  mocks.customFields = [];
  mocks.typesState = {
    data: TYPES,
    isLoading: false,
    isError: false,
    refetch: mocks.refetchTypes,
  };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("CreateWorkItemDialog custom fields", () => {
  const field = {
    id: "cf-1",
    key: "asset_tag",
    name: "Asset tag",
    format: "text",
    options: [],
    helpText: null,
    visibilityCondition: null,
    sectionId: "sec-1",
    position: 0,
    visibility: [{ workItemTypeId: "type-1", visible: true, required: true }],
  };

  it("shows only the fields that apply to the chosen type and holds submit until a required one is filled", async () => {
    mocks.customFields = [
      field,
      {
        ...field,
        id: "cf-2",
        key: "bug_only",
        name: "Bug only",
        visibility: [
          { workItemTypeId: "type-2", visible: true, required: false },
        ],
      },
    ];
    mocks.mutateAsync.mockResolvedValue({ id: "wi-1", key: "OPS-1" });
    renderDialog();
    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Replace the laptop" },
    });
    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("button", { name: "Task" }));

    expect(screen.getByLabelText(/Asset tag/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Bug only/)).toBeNull();
    const submit = screen.getByRole("button", {
      name: "workItems:create.submit",
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Asset tag/), {
      target: { value: "LT-204" },
    });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.lastCreateInput).toMatchObject({
      customFields: { asset_tag: "LT-204" },
    });
  });

  it("hides a conditional field until its condition holds", async () => {
    mocks.customFields = [
      {
        ...field,
        id: "cf-1",
        key: "risk",
        name: "Risk",
        format: "text",
        visibility: [
          { workItemTypeId: "type-1", visible: true, required: false },
        ],
      },
      {
        ...field,
        id: "cf-2",
        key: "rollback",
        name: "Rollback plan",
        visibility: [
          { workItemTypeId: "type-1", visible: true, required: true },
        ],
        visibilityCondition: { field_key: "risk", op: "eq", value: "high" },
      },
    ];
    renderDialog();
    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("button", { name: "Task" }));
    expect(screen.queryByLabelText(/Rollback plan/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/Risk/), {
      target: { value: "high" },
    });
    expect(screen.getByLabelText(/Rollback plan/)).toBeInTheDocument();
  });
});

describe("CreateWorkItemDialog", () => {
  it("offers no template control until the workspace has a live template", () => {
    renderDialog();
    expect(
      screen.queryByTestId("create-work-item-template-trigger"),
    ).toBeNull();
  });

  it("creating from a template sends its id, adopts its type and fills only an empty title", async () => {
    mocks.templates = [
      {
        id: "tpl-1",
        name: "Bug report",
        typeId: "type-1",
        title: "Bug: ",
        hasChecklist: true,
      },
    ];
    mocks.mutateAsync.mockResolvedValue({ id: "wi-1", key: "OPS-1" });
    renderDialog();
    fireEvent.click(screen.getByTestId("create-work-item-template-trigger"));
    pickOption(await screen.findByRole("button", { name: "Bug report" }));
    expect(screen.getByTestId("create-work-item-title")).toHaveValue("Bug: ");
    expect(
      screen.getByTestId("create-work-item-type-trigger"),
    ).toHaveTextContent("Task");

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Bug: crash on save" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    );
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1));
    expect(mocks.lastCreateInput).toMatchObject({
      templateId: "tpl-1",
      typeId: "type-1",
      title: "Bug: crash on save",
    });
  });

  it("keeps submit disabled until both a title and a type are chosen", async () => {
    renderDialog();
    const submit = screen.getByRole("button", {
      name: "workItems:create.submit",
    });
    expect(submit).toBeDisabled();
    // The trigger shows the option's LABEL, never the raw value -- a browser run caught the
    // raw `type id` / `high` rendering before `items` was supplied to the Selects.
    expect(
      screen.getByTestId("create-work-item-priority-trigger"),
    ).toHaveTextContent("workItems:create.priorityNone");

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Fix the login bug" },
    });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("button", { name: "Task" }));
    expect(
      screen.getByTestId("create-work-item-type-trigger"),
    ).toHaveTextContent("Task");
    expect(submit).toBeEnabled();
  });

  it("creates with the chosen type, title, priority and description, then invalidates the list and closes", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "wi-1" });
    const onClose = renderDialog();

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Fix the login bug" },
    });
    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("button", { name: "Task" }));

    fireEvent.click(screen.getByTestId("create-work-item-priority-trigger"));
    pickOption(
      await screen.findByRole("button", {
        name: "workItems:list.priority.high",
      }),
    );
    expect(
      screen.getByTestId("create-work-item-priority-trigger"),
    ).toHaveTextContent("workItems:list.priority.high");

    fireEvent.change(screen.getByTestId("create-work-item-description"), {
      target: { value: "First line\nSecond line" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    );

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    expect(mocks.mutateAsync.mock.calls[0]?.[0]).toEqual({
      projectId: "proj-1",
      typeId: "type-1",
      title: "Fix the login bug",
      description: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "First line" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "Second line" }],
          },
        ],
      },
      priority: "high",
    });
    await waitFor(() => {
      expect(mocks.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["work-items", "proj-1"],
      });
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith("workItems:create.success");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("omits the description entirely when left empty", async () => {
    mocks.mutateAsync.mockResolvedValue({ id: "wi-1" });
    renderDialog();

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "No description here" },
    });
    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("button", { name: "Task" }));
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    );

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
    });
    const submitted = mocks.mutateAsync.mock.calls[0]?.[0] as
      | { description?: unknown; priority?: unknown }
      | undefined;
    expect(submitted?.description).toBeUndefined();
    expect(submitted?.priority).toBeUndefined();
  });

  it("keeps the dialog open and explains a 403 instead of closing", async () => {
    mocks.mutateAsync.mockRejectedValue(new HttpError(403, "Insufficient"));
    const onClose = renderDialog();

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Forbidden attempt" },
    });
    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("button", { name: "Task" }));
    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    );

    expect(
      await screen.findByTestId("create-work-item-error"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("workItems:create.errorForbidden"),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows the retry affordance and keeps submit disabled when the types request fails", async () => {
    mocks.typesState = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Cannot pick a type" },
    });
    expect(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "workItems:create.typesRetry" }),
    );
    expect(mocks.refetchTypes).toHaveBeenCalledTimes(1);
  });

  it("disables the type select and shows the loading placeholder while types load", () => {
    mocks.typesState = {
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    const typeTrigger = screen.getByTestId("create-work-item-type-trigger");
    expect(typeTrigger).toBeDisabled();
    expect(typeTrigger).toHaveTextContent("workItems:create.typesLoading");
    expect(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    ).toBeDisabled();
    expect(
      screen.queryByText("workItems:create.noTypes"),
    ).not.toBeInTheDocument();
  });

  it("explains why Create is disabled until a type is chosen", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("create-work-item-title"), {
      target: { value: "Replace the laptop" },
    });
    expect(screen.getByTestId("create-work-item-type-hint")).toHaveTextContent(
      "workItems:create.typeRequired",
    );
    expect(
      screen.getByRole("button", { name: "workItems:create.submit" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("button", { name: "Task" }));
    expect(screen.queryByTestId("create-work-item-type-hint")).toBeNull();
  });

  it("says so when the workspace has no types at all", () => {
    mocks.typesState = {
      data: [],
      isLoading: false,
      isError: false,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    expect(screen.getByText("workItems:create.noTypes")).toBeInTheDocument();
  });

  it("does not claim the workspace has no types when the query never produced a list", () => {
    mocks.typesState = {
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    expect(
      screen.queryByText("workItems:create.noTypes"),
    ).not.toBeInTheDocument();
  });

  it("renders a type name containing markup as literal text, never as an element", async () => {
    const maliciousName = "<img src=x onerror=alert(1)>";
    mocks.typesState = {
      data: [{ id: "type-1", key: "xss", name: maliciousName }],
      isLoading: false,
      isError: false,
      refetch: mocks.refetchTypes,
    };
    renderDialog();

    fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
    pickOption(await screen.findByRole("button", { name: maliciousName }));

    const dialog = screen.getByTestId("create-work-item-dialog");
    expect(dialog.querySelector("img")).toBeNull();
    expect(
      screen.getByTestId("create-work-item-type-trigger"),
    ).toHaveTextContent(maliciousName);
  });
});

async function fillRequired() {
  fireEvent.change(screen.getByTestId("create-work-item-title"), {
    target: { value: "Visible persisted work" },
  });
  fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
  fireEvent.click(await screen.findByRole("button", { name: "Task" }));
}

it("uses the original title-first/editor/chips/footer composition with persisted property controls", async () => {
  renderDialog();
  const form = screen.getByTestId("create-work-item-title").closest("form");
  expect(form?.querySelector("input")).toBe(
    screen.getByTestId("create-work-item-title"),
  );
  expect(screen.getByTestId("create-work-item-title")).toHaveFocus();
  expect(screen.getByTestId("create-work-item-type-trigger")).not.toHaveClass(
    "w-full",
  );
  expect(
    screen.getByRole("checkbox", {
      name: "common:modals.createTask.createMore",
    }),
  ).toBeInTheDocument();
  for (const field of ["assign", "startDate", "dueDate", "labels"]) {
    expect(
      screen.getByRole("button", { name: `common:modals.createTask.${field}` }),
    ).toBeInTheDocument();
  }
  expect(
    screen.getByTestId("create-work-item-default-state"),
  ).toHaveTextContent("Backlog");
});

it("creates more real items while retaining the required type and returning focus to the cleared title", async () => {
  mocks.mutateAsync.mockResolvedValue({ key: "HELP-20" });
  const onClose = renderDialog();
  await fillRequired();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "common:modals.createTask.createMore",
    }),
  );
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await waitFor(() =>
    expect(screen.getByTestId("create-work-item-title")).toHaveValue(""),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByTestId("create-work-item-title")).toHaveFocus();
  expect(screen.getByTestId("create-work-item-type-trigger")).toHaveTextContent(
    "Task",
  );
  expect(screen.getByTestId("create-work-item-submit")).toBeDisabled();
  fireEvent.change(screen.getByTestId("create-work-item-title"), {
    target: { value: "Second real item" },
  });
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(2));
  expect(mocks.mutateAsync.mock.calls[1][0]).toMatchObject({
    typeId: "type-1",
    title: "Second real item",
  });
});

it("refuses duplicate submissions before the mutation's pending render arrives", async () => {
  let complete!: (value: unknown) => void;
  mocks.mutateAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  renderDialog();
  await fillRequired();
  const form = screen.getByTestId("create-work-item-submit").closest("form");
  if (!form) throw new Error("missing create form");
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  complete({ key: "HELP-21" });
  await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce());
});

it("never submits after the scoped create capability is absent", async () => {
  mocks.canCreate = false;
  renderDialog();
  await fillRequired();
  expect(screen.getByTestId("create-work-item-submit")).toBeDisabled();
  const form = screen.getByTestId("create-work-item-submit").closest("form");
  if (form) fireEvent.submit(form);
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});

it.each([400, 500])(
  "preserves draft and typed error after create HTTP %i",
  async (status) => {
    mocks.mutateAsync.mockRejectedValue(
      new HttpError(status, "private server detail"),
    );
    const onClose = renderDialog();
    await fillRequired();
    fireEvent.click(screen.getByTestId("create-work-item-submit"));
    expect(
      await screen.findByTestId("create-work-item-error"),
    ).toHaveTextContent(
      status === 400
        ? "workItems:create.errorInvalid"
        : "workItems:create.errorGeneric",
    );
    expect(screen.getByTestId("create-work-item-title")).toHaveValue(
      "Visible persisted work",
    );
    expect(screen.getByTestId("create-work-item-error")).not.toHaveTextContent(
      "private server detail",
    );
    expect(onClose).not.toHaveBeenCalled();
  },
);

it("persists the actual rich editor document without flattening its formatting", async () => {
  mocks.mutateAsync.mockResolvedValue({ key: "HELP-22" });
  mocks.editorDocument = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [
          {
            type: "text",
            text: "Formatted heading",
            marks: [{ type: "bold" }],
          },
        ],
      },
    ],
  };
  renderDialog();
  await fillRequired();
  fireEvent.change(screen.getByTestId("create-work-item-description"), {
    target: { value: "## **Formatted heading**" },
  });
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledOnce());
  expect(mocks.mutateAsync.mock.calls[0][0].description).toEqual(
    mocks.editorDocument,
  );
});

it("does not close or toast a different routed intent after the pending create unmounts", async () => {
  let complete!: (value: unknown) => void;
  mocks.mutateAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const onClose = renderDialog();
  await fillRequired();
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  cleanup();
  await act(async () => {
    complete({ key: "HELP-23" });
    await Promise.resolve();
  });
  expect(mocks.invalidateQueries).toHaveBeenCalledWith({
    queryKey: ["work-items", "proj-1"],
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(mocks.toastSuccess).not.toHaveBeenCalled();
});

it("submits dates, roster assignee and catalogue labels in one atomic create payload", async () => {
  mocks.mutateAsync.mockResolvedValue({ key: "HELP-21" });
  renderDialog();
  await fillRequired();
  const start = screen.getByTestId("create-work-item-startDate-trigger");
  fireEvent.click(start);
  const month = new Date().toLocaleString("en-US", { month: "long" });
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(`${month} 15`) }),
  );
  fireEvent.click(start);
  const due = screen.getByTestId("create-work-item-dueDate-trigger");
  fireEvent.click(due);
  fireEvent.click(
    await screen.findByRole("button", { name: new RegExp(`${month} 20`) }),
  );
  fireEvent.click(due);
  const assignee = screen.getByTestId("create-work-item-assignee-trigger");
  fireEvent.click(assignee);
  fireEvent.click(await screen.findByRole("button", { name: "Ada Agent" }));
  fireEvent.click(assignee);
  const labels = screen.getByTestId("create-work-item-labels-trigger");
  fireEvent.click(labels);
  fireEvent.click(await screen.findByRole("button", { name: "Release" }));
  fireEvent.click(labels);
  expect(
    screen.getByRole("button", {
      name: "common:modals.createTask.labels: Release",
    }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "common:modals.createTask.createMore",
    }),
  );
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  const now = new Date();
  const prefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  await waitFor(() =>
    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-1",
        typeId: "type-1",
        assigneeId: "person-1",
        labelIds: ["label-1"],
        startDate: `${prefix}-15T00:00:00.000Z`,
        dueDate: `${prefix}-20T00:00:00.000Z`,
      }),
    ),
  );
  expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(screen.getByTestId("create-work-item-title")).toHaveValue(""),
  );
  expect(start).toHaveTextContent("common:modals.createTask.startDate");
  expect(due).toHaveTextContent("common:modals.createTask.dueDate");
  expect(
    screen.getByTestId("create-work-item-assignee-trigger"),
  ).not.toHaveTextContent("Ada Agent");
  expect(
    screen.queryByRole("button", {
      name: "common:modals.createTask.labels: Release",
    }),
  ).not.toBeInTheDocument();
});
it("retains optional field drafts after a server validation error", async () => {
  mocks.mutateAsync.mockRejectedValue(
    new HttpError(422, "Invalid foreign selection"),
  );
  renderDialog();
  await fillRequired();
  const trigger = screen.getByTestId("create-work-item-labels-trigger");
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("button", { name: "Release" }));
  fireEvent.click(trigger);
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await screen.findByTestId("create-work-item-error");
  expect(screen.getByTestId("create-work-item-title")).toHaveValue(
    "Visible persisted work",
  );
  expect(
    screen.getByRole("button", {
      name: "common:modals.createTask.labels: Release",
    }),
  ).toBeInTheDocument();
});
it("keeps basic creation available without optional field authority or unavailable catalogues", async () => {
  mocks.canUpdate = false;
  mocks.canAssign = false;
  mocks.options.peopleError = true;
  mocks.options.labelsError = true;
  renderDialog();
  await fillRequired();
  for (const field of ["startDate", "dueDate", "assignee", "labels"])
    expect(
      screen.getByTestId(`create-work-item-${field}-trigger`),
    ).toBeDisabled();
  expect(screen.getByTestId("create-work-item-submit")).toBeEnabled();
});
it("blocks a selected optional draft when its catalogue loses authority and keeps it dirty", async () => {
  const onDraftStateChange = vi.fn();
  const view = render(
    <CreateWorkItemDialogForm
      onClose={vi.fn()}
      onDraftStateChange={onDraftStateChange}
      projectId="proj-1"
      workspaceId="ws-1"
    />,
  );
  await fillRequired();
  const trigger = screen.getByTestId("create-work-item-labels-trigger");
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("button", { name: "Release" }));
  fireEvent.click(trigger);
  mocks.options.labelsError = true;
  view.rerender(
    <CreateWorkItemDialogForm
      onClose={vi.fn()}
      onDraftStateChange={onDraftStateChange}
      projectId="proj-1"
      workspaceId="ws-1"
    />,
  );
  expect(screen.getByTestId("create-work-item-submit")).toBeDisabled();
  await waitFor(() =>
    expect(onDraftStateChange).toHaveBeenLastCalledWith({
      dirty: true,
      busy: false,
    }),
  );
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});
it("clears optional assignee and labels on Create more and reports an empty draft", async () => {
  mocks.mutateAsync.mockResolvedValue({ key: "HELP-22" });
  const onDraftStateChange = vi.fn();
  render(
    <CreateWorkItemDialogForm
      onClose={vi.fn()}
      onDraftStateChange={onDraftStateChange}
      projectId="proj-1"
      workspaceId="ws-1"
    />,
  );
  await fillRequired();
  const assignee = screen.getByTestId("create-work-item-assignee-trigger");
  fireEvent.click(assignee);
  fireEvent.click(await screen.findByRole("button", { name: "Ada Agent" }));
  fireEvent.click(assignee);
  const labels = screen.getByTestId("create-work-item-labels-trigger");
  fireEvent.click(labels);
  fireEvent.click(await screen.findByRole("button", { name: "Release" }));
  fireEvent.click(labels);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "common:modals.createTask.createMore",
    }),
  );
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await waitFor(() =>
    expect(screen.getByTestId("create-work-item-title")).toHaveValue(""),
  );
  expect(
    screen.getByTestId("create-work-item-assignee-trigger"),
  ).not.toHaveTextContent("Ada Agent");
  expect(
    screen.queryByRole("button", {
      name: "common:modals.createTask.labels: Release",
    }),
  ).not.toBeInTheDocument();
  await waitFor(() =>
    expect(onDraftStateChange).toHaveBeenLastCalledWith({
      dirty: false,
      busy: false,
    }),
  );
});

it("creates a real catalogue definition through the original colour flow, then includes only its ID in one item create", async () => {
  mocks.canManageLabels = true;
  mocks.createLabel.mockResolvedValue({
    id: "new-label",
    name: "Release window",
    color: "purple",
    workspaceId: "ws-1",
    taskId: null,
  });
  mocks.mutateAsync.mockResolvedValue({ key: "HELP-30" });
  renderDialog();
  await fillRequired();
  fireEvent.click(screen.getByTestId("create-work-item-labels-trigger"));
  fireEvent.change(
    screen.getByRole("textbox", {
      name: "common:modals.createTask.searchLabels",
    }),
    { target: { value: "Release window" } },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "common:modals.createTask.createLabel",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "common:modals.createTask.labelColors.lavender",
    }),
  );
  await screen.findByRole("button", {
    name: "common:modals.createTask.labels: Release window",
  });
  expect(mocks.createLabel).toHaveBeenCalledWith({
    name: "Release window",
    color: "purple",
    workspaceId: "ws-1",
  });
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await waitFor(() =>
    expect(mocks.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ labelIds: ["new-label"] }),
    ),
  );
  expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
});
it("propagates catalogue creation busy state to submit/discard and retains failed label name for retry", async () => {
  mocks.canManageLabels = true;
  let reject: ((error: Error) => void) | undefined;
  mocks.createLabel.mockImplementation(
    () =>
      new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      }),
  );
  const onDraftStateChange = vi.fn();
  render(
    <CreateWorkItemDialogForm
      onClose={vi.fn()}
      onDraftStateChange={onDraftStateChange}
      projectId="proj-1"
      workspaceId="ws-1"
    />,
  );
  await fillRequired();
  fireEvent.click(screen.getByTestId("create-work-item-labels-trigger"));
  fireEvent.change(
    screen.getByRole("textbox", {
      name: "common:modals.createTask.searchLabels",
    }),
    { target: { value: "Retry label" } },
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "common:modals.createTask.createLabel",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "common:modals.createTask.labelColors.sage",
    }),
  );
  expect(screen.getByTestId("create-work-item-submit")).toBeDisabled();
  await waitFor(() =>
    expect(onDraftStateChange).toHaveBeenLastCalledWith({
      dirty: true,
      busy: true,
    }),
  );
  await act(async () => {
    reject?.(new Error("Denied"));
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "common:modals.createTask.labelCreateError",
  );
  await waitFor(() =>
    expect(onDraftStateChange).toHaveBeenLastCalledWith({
      dirty: true,
      busy: false,
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "common:actions.cancel" }),
  );
  expect(
    screen.getByRole("textbox", {
      name: "common:modals.createTask.searchLabels",
    }),
  ).toHaveValue("Retry label");
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});

it("stages locally then retries failed files against one confirmed created item", async () => {
  const onClose = renderDialog();
  fireEvent.change(screen.getByTestId("stage-files"), {
    target: { files: [new File(["a"], "a.txt"), new File(["b"], "b.txt")] },
  });
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  expect(mocks.uploadAttachment).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("create-work-item-title"), {
    target: { value: "Attachment batch" },
  });
  fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
  pickOption(await screen.findByRole("button", { name: "Task" }));
  mocks.mutateAsync.mockResolvedValue({ key: "HELP-1" });
  mocks.uploadAttachment
    .mockResolvedValueOnce({ id: "a" })
    .mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await screen.findByTestId("create-work-item-partial");
  await waitFor(() =>
    expect(screen.getByTestId("create-work-item-submit")).toBeEnabled(),
  );
  expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();
  mocks.uploadAttachment.mockResolvedValueOnce({ id: "b" });
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
  expect(mocks.uploadAttachment).toHaveBeenCalledTimes(3);
  expect(
    mocks.uploadAttachment.mock.calls.every((call) => call[0] === "HELP-1"),
  ).toBe(true);
});
it("hides staging for denied attachment authority and blocks repeat ambiguous creates", async () => {
  mocks.canAttach = false;
  renderDialog();
  expect(screen.queryByTestId("stage-files")).not.toBeInTheDocument();
  fireEvent.change(screen.getByTestId("create-work-item-title"), {
    target: { value: "Unknown outcome" },
  });
  fireEvent.click(screen.getByTestId("create-work-item-type-trigger"));
  pickOption(await screen.findByRole("button", { name: "Task" }));
  mocks.mutateAsync.mockRejectedValue(new Error("connection lost"));
  fireEvent.click(screen.getByTestId("create-work-item-submit"));
  await screen.findByText("workItems:create.attachments.createUnknown");
  expect(screen.getByTestId("create-work-item-submit")).toBeDisabled();
  expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
});
