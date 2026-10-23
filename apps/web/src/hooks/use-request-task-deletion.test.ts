import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRequestTaskDeletion } from "./use-request-task-deletion";

const mocks = vi.hoisted(() => ({
  deleteTask: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: mocks.deleteTask }),
}));
vi.mock("@/hooks/use-open-pending-action", () => ({
  useOpenPendingAction: () => mocks.open,
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.error, success: vi.fn() },
}));

beforeEach(() => {
  mocks.deleteTask.mockReset();
  mocks.open.mockReset();
  mocks.error.mockReset();
});

describe("board and list task deletion", () => {
  it("requests by work item key and opens the in-place approval as the single confirmation", async () => {
    mocks.deleteTask.mockResolvedValue({ pendingActionId: "pa-1" });
    const { result } = renderHook(() => useRequestTaskDeletion("WLP"));
    await act(() => result.current({ number: 7 }));
    expect(mocks.deleteTask).toHaveBeenCalledWith("WLP-7");
    expect(mocks.open).toHaveBeenCalledWith({ pendingActionId: "pa-1" });
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("reports a refusal and opens nothing", async () => {
    mocks.deleteTask.mockRejectedValue(new Error("denied"));
    const { result } = renderHook(() => useRequestTaskDeletion("WLP"));
    await act(() => result.current({ number: 7 }));
    expect(mocks.error).toHaveBeenCalledWith("denied");
    expect(mocks.open).not.toHaveBeenCalled();
  });

  it("never sends a task id as a key when the key cannot be formed", async () => {
    const { result } = renderHook(() => useRequestTaskDeletion(undefined));
    await act(() => result.current({ number: 7 }));
    expect(mocks.deleteTask).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith("tasks:delete.error");
  });
});
