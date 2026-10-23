import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOpenPendingAction } from "@/hooks/use-open-pending-action";
import usePendingActionDialogStore from "@/store/pending-action-dialog";
import PendingActionApprovalDialog from "./pending-action-approval-dialog";

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  cancel: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

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
          data: {
            id: String(queryKey[2]),
            action: "delete",
            targetType: "label",
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
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
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
  createPendingActionProof: vi.fn(),
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
    usePendingActionDialogStore.setState({ pendingActionId: null });
    mocks.approve.mockReset().mockResolvedValue({ state: "executed" });
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

  it("renders nothing until a request opens it", () => {
    render(<PendingActionApprovalDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
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
});
