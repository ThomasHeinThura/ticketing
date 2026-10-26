import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskDeleteButton from "./task-delete-button";

const mocks = vi.hoisted(() => ({
  canDeleteTasks: vi.fn(),
  deleteTask: vi.fn(),
  openPendingAction: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({
    mutateAsync: mocks.deleteTask,
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.openPendingAction,
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canDeleteTasks: mocks.canDeleteTasks,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.error, success: mocks.success },
}));

beforeEach(() => {
  mocks.canDeleteTasks.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDeleteButton", () => {
  it("is only shown to users with task deletion permission", () => {
    mocks.canDeleteTasks.mockReturnValue(false);

    render(<TaskDeleteButton workItemKey="PROJ-1" />);

    expect(
      screen.queryByRole("button", { name: "tasks:delete.action" }),
    ).toBeNull();
  });

  it("requests deletion directly (no pre-confirm) and opens the in-place approval", async () => {
    const onRequested = vi.fn();
    mocks.deleteTask.mockResolvedValue({ pendingActionId: "pa-1" });
    render(<TaskDeleteButton workItemKey="PROJ-1" onRequested={onRequested} />);

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:delete.action" }),
    );

    await waitFor(() =>
      expect(mocks.deleteTask).toHaveBeenCalledWith("PROJ-1"),
    );
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa-1",
        finalFocus: expect.any(Function),
      }),
    );
    const finalFocus = mocks.openPendingAction.mock.calls[0]?.[0]?.finalFocus as
      | (() => HTMLElement | false)
      | undefined;
    expect(finalFocus?.()).toBe(
      screen.getByRole("button", { name: "tasks:delete.action" }),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onRequested).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("passes the original trigger as a connected-only final-focus target", async () => {
    mocks.deleteTask.mockResolvedValue({ pendingActionId: "pa-focus" });
    render(<TaskDeleteButton workItemKey="PROJ-1" />);
    const trigger = screen.getByRole("button", {
      name: "tasks:delete.action",
    });
    trigger.focus();

    fireEvent.click(trigger);
    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa-focus",
        finalFocus: expect.any(Function),
      }),
    );
    const finalFocus = mocks.openPendingAction.mock.calls[0]?.[0]?.finalFocus as
      | (() => HTMLElement | false)
      | undefined;
    expect(finalFocus?.()).toBe(trigger);
  });

  it("rejects a trigger removed by the request callback", async () => {
    mocks.deleteTask.mockResolvedValue({ pendingActionId: "pa-detached" });
    let rerender!: (ui: React.ReactNode) => void;
    const view = render(<TaskDeleteButton workItemKey="PROJ-1" />);
    rerender = view.rerender;
    const trigger = screen.getByRole("button", {
      name: "tasks:delete.action",
    });
    view.rerender(
      <TaskDeleteButton
        workItemKey="PROJ-1"
        onRequested={() =>
          rerender(<TaskDeleteButton workItemKey={undefined} />)
        }
      />,
    );
    fireEvent.click(trigger);

    await waitFor(() =>
      expect(mocks.openPendingAction).toHaveBeenCalledWith({
        pendingActionId: "pa-detached",
        finalFocus: expect.any(Function),
      }),
    );
    const finalFocus = mocks.openPendingAction.mock.calls[0]?.[0]?.finalFocus as
      | (() => HTMLElement | false)
      | undefined;
    expect(trigger.isConnected).toBe(false);
    expect(finalFocus?.()).toBe(false);
  });

  it("keeps the current view open and reports a failed deletion", async () => {
    const onRequested = vi.fn();
    mocks.deleteTask.mockRejectedValue(new Error("Delete denied"));
    render(<TaskDeleteButton workItemKey="PROJ-1" onRequested={onRequested} />);

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:delete.action" }),
    );

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Delete denied"),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.openPendingAction).not.toHaveBeenCalled();
    expect(onRequested).not.toHaveBeenCalled();
  });
});
