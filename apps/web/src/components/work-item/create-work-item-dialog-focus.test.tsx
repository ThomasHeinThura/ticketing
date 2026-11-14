import { Button, Input, Textarea } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import WorkItemCreateDialogShell from "./work-item-create-dialog-shell";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  invalidateQueries: vi.fn(),
  toastSuccess: vi.fn(),
  refetchTypes: vi.fn(),
  lastCreateInput: undefined as unknown,
  editorDocument: undefined as unknown,
  moveCreated: vi.fn(),
  toastWarning: vi.fn(),
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
  formModule: undefined as unknown,
  formStarted: undefined as (() => void) | undefined,
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

// A-03: the requester chip has its own tests; with no customers it renders nothing.
vi.mock("./create-work-item-requester-picker", () => ({
  default: () => null,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: mocks.toastSuccess,
    error: vi.fn(),
    warning: mocks.toastWarning,
  },
}));
vi.mock("./move-created-work-item", () => ({
  moveCreatedWorkItemToState: mocks.moveCreated,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [{ id: "proj-1", slug: "HELP" }] }),
}));
vi.mock("./create-work-item-dialog-form", async () => {
  mocks.formStarted?.();
  await new Promise((resolve) => setTimeout(resolve, 200));
  return mocks.formModule;
});

// jsdom otherwise allows focus in display:none, hiding reveal regressions.
beforeEach(() => {
  const focus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
    this: HTMLElement,
    options,
  ) {
    let node: HTMLElement | null = this;
    while (node) {
      if (node.style.display === "none") return;
      node = node.parentElement;
    }
    focus.call(this, options);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("focuses the real lazy form after release and returns focus on close", async () => {
  mocks.formModule = await vi.importActual("./create-work-item-dialog-form");
  const started = new Promise<void>((resolve) => {
    mocks.formStarted = resolve;
  });
  vi.useFakeTimers();
  function Harness() {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    return (
      <>
        <Button ref={trigger} onClick={() => setOpen(true)}>
          Open
        </Button>
        {open && (
          <WorkItemCreateDialogShell
            projectId="proj-1"
            workspaceId="ws-1"
            onClose={() => setOpen(false)}
            finalFocus={() => trigger.current ?? false}
          />
        )}
      </>
    );
  }
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "Open" });
  trigger.focus();
  fireEvent.click(trigger);
  await started;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(screen.getByTestId("create-work-item-dialog-loading")).toBeVisible();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(screen.getByTestId("create-work-item-title")).not.toBeVisible();
  expect(screen.getByTestId("create-work-item-title")).not.toHaveFocus();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  const dialog = screen.getByRole("dialog");
  expect(screen.getByTestId("create-work-item-title")).toHaveFocus();
  // jsdom does not implement Tab's native focus movement. Move to Base UI's
  // preceding focus guard as the browser does when Shift+Tab leaves the first
  // control, then check the dialog's guard redirects focus back inside.
  const focusGuard = document.querySelector<HTMLElement>(
    '[data-base-ui-focus-guard][data-type="inside"]',
  );
  if (!focusGuard) throw new Error("Dialog focus guard is missing");
  fireEvent.keyDown(document.activeElement ?? dialog, {
    key: "Tab",
    code: "Tab",
    shiftKey: true,
  });
  focusGuard.focus();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(dialog, { key: "Escape" });
  await act(async () => {
    await vi.runOnlyPendingTimersAsync();
  });
  expect(trigger).toHaveFocus();
});
