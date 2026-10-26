import { Button } from "@taskdesk/ui";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import usePendingActionDialogStore from "@/store/pending-action-dialog";
import PendingActionApprovalDialog from "./pending-action-approval-dialog";

const mocks = vi.hoisted(() => ({
  targetType: "label",
  action: { current: null as Record<string, unknown> | null },
  factor: {
    enabled: false,
    required: false,
    availableMethods: ["password"],
  },
  approve: vi.fn(),
  proof: vi.fn(),
  cancel: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

function PendingActionFocusHarness({
  request,
  detachTriggerAfterOpen = false,
  onFinalFocus,
}: {
  request: Promise<void>;
  detachTriggerAfterOpen?: boolean;
  onFinalFocus?: (target: HTMLElement | false) => void;
}) {
  const openPendingAction = useOpenPendingAction();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [showTrigger, setShowTrigger] = useState(true);

  async function requestDelete() {
    const trigger = triggerRef.current;
    const finalFocus = () => {
      const target = trigger?.isConnected ? trigger : false;
      onFinalFocus?.(target);
      return target;
    };
    setDeleting(true);
    await request;
    await openPendingAction({ pendingActionId: "pa-focus", finalFocus });
    setDeleting(false);
    if (detachTriggerAfterOpen) setShowTrigger(false);
  }

  return (
    <>
      {showTrigger && (
        <Button
          ref={triggerRef}
          disabled={deleting}
          onClick={() => void requestDelete()}
        >
          Delete project
        </Button>
      )}
      <PendingActionApprovalDialog />
    </>
  );
}

function deferredRequest() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: "/agent/dashboard" }),
  Link: ({ children }: { children: React.ReactNode }) => (
    <a href="/">{children}</a>
  ),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
    queryKey[0] === "me"
      ? {
          data: mocks.action.current ?? {
            id: String(queryKey[2]),
            action: "delete",
            targetType: mocks.targetType,
            summary: { name: "Bug" },
            targetIds: ["l1"],
            approvalSupported: true,
            confirmation: "click",
            state: "pending",
            origin: "web",
            expiresAt: "2026-10-12T00:00:00.000Z",
          },
          isLoading: false,
          isError: false,
        }
      : queryKey[0] === "god-mode"
        ? {
            data: mocks.factor,
            isLoading: false,
            isError: false,
          }
        : { data: undefined, isLoading: false, isError: false },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: ({
    mutationFn,
  }: {
    mutationFn: (v: unknown) => Promise<unknown>;
  }) => ({
    isPending: false,
    mutateAsync: (value: unknown) => mutationFn(value),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en", resolvedLanguage: "en" },
    t: (key: string) => key,
  }),
}));
vi.mock("@/lib/i18n/terminology-provider", () => ({
  TerminologyProvider: ({
    workspaceId,
    children,
  }: {
    workspaceId?: string | null;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="target-terms"
      data-workspace-id={workspaceId ?? "instance"}
    >
      {children}
    </div>
  ),
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/lib/toast", () => ({
  toast: { success: (message: string) => mocks.toast(message), error: vi.fn() },
}));
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getCurrentFactorStatus: vi.fn(),
  getInstanceUser: vi.fn(),
}));
vi.mock("@/fetchers/pending-actions", () => ({
  approveOwnPendingAction: (value: unknown) => mocks.approve(value),
  cancelOwnPendingAction: (value: unknown) => mocks.cancel(value),
  createPendingActionProof: (value: unknown) => mocks.proof(value),
  getOwnPendingAction: vi.fn(),
}));
vi.mock("@/hooks/queries/god-mode/use-instance-users", () => ({
  instanceUsersKey: ["instance-users"],
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

describe("in-place deletion approval", () => {
  beforeEach(() => {
    mocks.targetType = "label";
    mocks.action.current = null;
    usePendingActionDialogStore.setState({
      pendingActionId: null,
      finalFocus: null,
    });
    mocks.approve.mockReset().mockResolvedValue({ state: "executed" });
    mocks.proof.mockReset().mockResolvedValue("proof-1");
    mocks.cancel.mockReset().mockResolvedValue({});
    mocks.navigate.mockReset();
    mocks.toast.mockReset();
  });
  afterEach(() => cleanup());

  it("opens from the hook without leaving the current screen", async () => {
    const { result } = renderHook(() => useOpenPendingAction());
    await act(() => result.current({ pendingActionId: "pa-1" }));
    expect(usePendingActionDialogStore.getState().pendingActionId).toBe("pa-1");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("returns focus to the async-disabled project trigger after Escape", async () => {
    const request = deferredRequest();
    render(<PendingActionFocusHarness request={request.promise} />);
    const trigger = screen.getByRole("button", { name: "Delete project" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toBeDisabled();

    await act(async () => request.resolve());
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(trigger).toBeEnabled());
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("does not restore focus to a detached async trigger", async () => {
    const request = deferredRequest();
    const onFinalFocus = vi.fn();
    render(
      <PendingActionFocusHarness
        request={request.promise}
        detachTriggerAfterOpen
        onFinalFocus={onFinalFocus}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Delete project" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toBeDisabled();

    await act(async () => request.resolve());
    const dialog = await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Delete project" })).toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(onFinalFocus).toHaveBeenCalledWith(false));
    expect(document.activeElement).not.toBe(trigger);
  });

  it("renders nothing until a request opens it", () => {
    render(<PendingActionApprovalDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    "project_page",
    "cycle",
    "module",
    "dashboard",
    "service",
    "time_entry",
    "cost_entry",
    "team",
    "automation",
    "webhook",
    "kb_category",
    "custom_field",
  ])("approves the registered %s click flow", async (targetType) => {
    mocks.targetType = targetType;
    usePendingActionDialogStore.setState({ pendingActionId: "pa-1" });
    render(<PendingActionApprovalDialog />);
    expect(
      await screen.findByRole("heading", {
        name: `pendingActions:registered.actions.${targetType}`,
      }),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("pendingActions:registered.confirmName"),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({ id: "pa-1" }),
    );
  });

  it("approves in a dialog, then closes it", async () => {
    usePendingActionDialogStore.setState({ pendingActionId: "pa-1" });
    render(<PendingActionApprovalDialog />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Bug");
    // The single confirmation is titled with the destructive action, not "pending action".
    expect(
      screen.getByRole("heading", {
        name: "pendingActions:registered.actions.label",
      }),
    ).toBeTruthy();
    // No navigation links inside the in-place approval.
    expect(dialog.querySelector("a")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "common:actions.delete" }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({ id: "pa-1" }),
    );
    await waitFor(() =>
      expect(usePendingActionDialogStore.getState().pendingActionId).toBeNull(),
    );
    expect(mocks.toast).toHaveBeenCalledWith("pendingActions:dialog.executed");
  });

  it("adds target workspace terms after loading without losing the typed draft or focus", async () => {
    mocks.action.current = {
      id: "pa-project-scope",
      action: "delete",
      targetType: "project",
      targetIds: ["project-1"],
      summary: { name: "QA Project" },
      approvalSupported: true,
      confirmation: "typed_name_step_up",
      state: "pending",
      origin: "web",
      expiresAt: "2026-10-26T00:00:00.000Z",
      targetWorkspaceId: null,
    };
    usePendingActionDialogStore.setState({
      pendingActionId: "pa-project-scope",
    });
    const view = render(<PendingActionApprovalDialog />);
    const input = await screen.findByLabelText(
      "pendingActions:registered.confirmProjectKey",
    );
    fireEvent.change(input, { target: { value: "QA Project" } });
    input.focus();
    expect(screen.getByTestId("target-terms")).toHaveAttribute(
      "data-workspace-id",
      "instance",
    );

    mocks.action.current = {
      ...mocks.action.current,
      targetWorkspaceId: "workspace-1",
    };
    view.rerender(<PendingActionApprovalDialog />);

    expect(screen.getByTestId("target-terms")).toHaveAttribute(
      "data-workspace-id",
      "workspace-1",
    );
    expect(input).toHaveValue("QA Project");
    expect(input).toHaveFocus();
  });

  it("cancels the request from the dialog and closes it", async () => {
    usePendingActionDialogStore.setState({ pendingActionId: "pa-2" });
    render(<PendingActionApprovalDialog />);
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: "pendingActions:copy.84837a216817" }),
    );
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("pa-2"));
    await waitFor(() =>
      expect(usePendingActionDialogStore.getState().pendingActionId).toBeNull(),
    );
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("shows organisation purge impact and requires exact name plus fresh step-up", async () => {
    mocks.action.current = {
      id: "pa-purge-1",
      action: "purge",
      targetType: "organisation",
      targetIds: ["opaque-org-id"],
      summary: {
        targetType: "organisation",
        targetId: "opaque-org-id",
        label: "QA Customer",
        name: "QA Customer",
        legalHold: "none",
        retention: "soft_deleted",
        workItems: 4,
        comments: 5,
        attachments: 6,
        impact: {
          organisations: 1,
          projects: 2,
          people: 3,
          workItems: 4,
          comments: 5,
          submissions: 5,
          attachments: 6,
          storageObjectsQueued: 6,
        },
      },
      approvalSupported: true,
      confirmation: "typed_name_step_up",
      state: "pending",
      origin: "web",
      expiresAt: "2026-10-26T00:00:00.000Z",
    };
    usePendingActionDialogStore.setState({ pendingActionId: "pa-purge-1" });
    render(<PendingActionApprovalDialog />);
    const dialog = await screen.findByRole("dialog");
    expect(
      screen.getByRole("heading", {
        name: "pendingActions:hardPurge.organisationAction",
      }),
    ).toBeVisible();
    expect(dialog).toHaveTextContent("QA Customer");
    expect(dialog).toHaveTextContent("pendingActions:hardPurge.noLegalHold");
    expect(dialog).toHaveTextContent("pendingActions:hardPurge.retention");
    expect(dialog).not.toHaveTextContent("opaque-org-id");

    fireEvent.change(
      screen.getByLabelText("pendingActions:hardPurge.confirmTarget"),
      { target: { value: "QA Customer" } },
    );
    const password = screen.getByLabelText(
      "pendingActions:dynamic.accountPassword",
    );
    fireEvent.change(password, { target: { value: "fresh-password" } });
    expect(password).toHaveValue("fresh-password");
    const approveButton = screen.getByRole("button", {
      name: "common:actions.delete",
    });
    expect(approveButton).toBeEnabled();
    fireEvent.click(approveButton);
    await waitFor(() =>
      expect(mocks.proof).toHaveBeenCalledWith({
        pendingActionId: "pa-purge-1",
        method: "password",
        secret: "fresh-password",
      }),
    );
    await waitFor(() =>
      expect(mocks.approve).toHaveBeenCalledWith({
        id: "pa-purge-1",
        typedName: "QA Customer",
        stepUpToken: "proof-1",
      }),
    );
  });

  it.each([
    { targetType: "project", label: "QA Project", workItems: 4 },
    { targetType: "work_item", label: "HELP-26", workItems: 1 },
  ])(
    "supports typed-name and fresh step-up for $targetType purge",
    async ({ targetType, label, workItems }) => {
      const targetId = `opaque-${targetType}-id`;
      mocks.action.current = {
        id: `pa-${targetType}-purge`,
        action: "purge",
        targetType,
        targetIds: [targetId],
        summary: {
          targetType,
          targetId,
          label,
          workItems,
          comments: 2,
          attachments: 3,
          legalHold: "none",
          retention: "soft_deleted",
        },
        approvalSupported: true,
        confirmation: "typed_name_step_up",
        state: "pending",
        origin: "web",
        expiresAt: "2026-10-26T00:00:00.000Z",
      };
      usePendingActionDialogStore.setState({
        pendingActionId: `pa-${targetType}-purge`,
      });
      render(<PendingActionApprovalDialog />);

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent(label);
      expect(dialog).not.toHaveTextContent(targetId);
      expect(
        screen.getByRole("heading", {
          name:
            targetType === "project"
              ? "pendingActions:hardPurge.projectAction"
              : "pendingActions:hardPurge.workItemAction",
        }),
      ).toBeVisible();
      fireEvent.change(
        screen.getByLabelText("pendingActions:hardPurge.confirmTarget"),
        { target: { value: label } },
      );
      const password = screen.getByLabelText(
        "pendingActions:dynamic.accountPassword",
      );
      fireEvent.change(password, { target: { value: "fresh-password" } });
      fireEvent.click(
        screen.getByRole("button", { name: "common:actions.delete" }),
      );
      await waitFor(() =>
        expect(mocks.proof).toHaveBeenCalledWith({
          pendingActionId: `pa-${targetType}-purge`,
          method: "password",
          secret: "fresh-password",
        }),
      );
      await waitFor(() =>
        expect(mocks.approve).toHaveBeenCalledWith({
          id: `pa-${targetType}-purge`,
          typedName: label,
          stepUpToken: "proof-1",
        }),
      );
    },
  );

  it.each(["work_item", "project", "organisation"])(
    "fails closed when %s purge facts are incomplete",
    (targetType) => {
      const targetId = `opaque-${targetType}-id`;
      mocks.action.current = {
        id: `pa-${targetType}-invalid`,
        action: "purge",
        targetType,
        targetIds: [targetId],
        summary: {
          targetType,
          targetId,
          label: "QA target",
          legalHold: "none",
          retention: "soft_deleted",
          ...(targetType === "organisation"
            ? { workItems: 1, comments: 2, attachments: 3 }
            : { workItems: 1, comments: 2 }),
        },
        approvalSupported: true,
        confirmation: "typed_name_step_up",
        state: "pending",
        origin: "web",
        expiresAt: "2026-10-26T00:00:00.000Z",
      };
      usePendingActionDialogStore.setState({
        pendingActionId: `pa-${targetType}-invalid`,
      });
      render(<PendingActionApprovalDialog />);
      expect(
        screen.getByText("pendingActions:hardPurge.unavailableDescription"),
      ).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "common:actions.delete" }),
      ).toBeNull();
      expect(screen.getByRole("dialog")).not.toHaveTextContent(targetId);
    },
  );

  it("fails closed for an unsupported purge target without showing its raw id", () => {
    mocks.action.current = {
      id: "pa-unsupported-purge",
      action: "purge",
      targetType: "workspace",
      targetIds: ["opaque-workspace-id"],
      summary: { targetType: "workspace", targetId: "opaque-workspace-id" },
      approvalSupported: true,
      confirmation: "typed_name_step_up",
      state: "pending",
      origin: "web",
      expiresAt: "2026-10-26T00:00:00.000Z",
    };
    usePendingActionDialogStore.setState({
      pendingActionId: "pa-unsupported-purge",
    });
    render(<PendingActionApprovalDialog />);
    expect(
      screen.getByText("pendingActions:hardPurge.unavailableDescription"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "common:actions.delete" }),
    ).toBeNull();
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "opaque-workspace-id",
    );
  });

  it("fails closed on a purge action whose eligibility summary is missing", async () => {
    mocks.action.current = {
      id: "pa-purge-2",
      action: "purge",
      targetType: "organisation",
      targetIds: ["opaque-org-id"],
      summary: { name: "QA Customer" },
      approvalSupported: true,
      confirmation: "typed_name_step_up",
      state: "pending",
      origin: "web",
      expiresAt: "2026-10-26T00:00:00.000Z",
    };
    usePendingActionDialogStore.setState({ pendingActionId: "pa-purge-2" });
    render(<PendingActionApprovalDialog />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "pendingActions:hardPurge.unavailableDescription",
    );
    expect(dialog).not.toHaveTextContent("opaque-org-id");
    expect(
      screen.queryByRole("button", { name: "common:actions.delete" }),
    ).toBeNull();
  });
});
