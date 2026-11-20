import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import useUpdateWorkspaceUserRole from "./use-update-workspace-user-role";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  refresh: vi.fn(),
  guard: vi.fn(),
}));
vi.mock("@/fetchers/workspace-user/update-workspace-member-role", () => ({
  default: mocks.save,
}));
vi.mock("@/components/settings/refresh-settings-history", () => ({
  refreshSettingsHistory: mocks.refresh,
}));
vi.mock("@/lib/profile-session-guard", () => ({
  profileSessionGuard: mocks.guard,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "actor" }, session: { id: "session" } },
    }),
  },
}));

it("refreshes the captured row and session only after a successful role save without waiting for history", async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  mocks.save.mockResolvedValueOnce({});
  mocks.guard.mockReturnValue(() => new Promise(() => {}));
  const { result } = renderHook(() => useUpdateWorkspaceUserRole(), {
    wrapper,
  });
  await act(() =>
    result.current.mutateAsync({
      workspaceId: "w",
      userId: "target-user",
      workspaceMemberId: "row",
      role: "admin",
    }),
  );
  expect(mocks.save).toHaveBeenCalledWith({
    workspaceId: "w",
    userId: "target-user",
    role: "admin",
  });
  expect(mocks.refresh).toHaveBeenCalledWith(
    client,
    [
      "settings-history",
      "workspace_member",
      "row",
      "agent",
      "actor",
      "session",
    ],
    expect.any(Function),
  );
  mocks.refresh.mockClear();
  mocks.save.mockRejectedValueOnce(new Error("refused"));
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        workspaceId: "w",
        userId: "target-user",
        workspaceMemberId: "row",
        role: "admin",
      }),
    ).rejects.toThrow("refused");
  });
  expect(mocks.refresh).not.toHaveBeenCalled();
});
