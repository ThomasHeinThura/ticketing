import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useUpdateProjectMemberRole } from "./use-project-member-mutations";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  refresh: vi.fn(),
  guard: vi.fn(),
}));
vi.mock("@/fetchers/project-member/project-members", () => ({
  addProjectMember: vi.fn(),
  removeProjectMember: vi.fn(),
  updateProjectMemberRole: mocks.save,
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

it("refreshes only the captured direct membership after success and never on refusal or inherited writes", async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  mocks.save.mockResolvedValue({});
  mocks.guard.mockReturnValue(() => new Promise(() => {}));
  const { result } = renderHook(() => useUpdateProjectMemberRole(), {
    wrapper,
  });
  await act(() =>
    result.current.mutateAsync({
      projectId: "p",
      personId: "person",
      membershipId: "row",
      roleKey: "lead",
    }),
  );
  expect(mocks.save).toHaveBeenCalledWith({
    projectId: "p",
    personId: "person",
    roleKey: "lead",
  });
  expect(mocks.refresh).toHaveBeenCalledWith(
    client,
    [
      "settings-history",
      "project_membership",
      "row",
      "agent",
      "actor",
      "session",
    ],
    expect.any(Function),
  );
  mocks.refresh.mockClear();
  await act(() =>
    result.current.mutateAsync({
      projectId: "p",
      personId: "person",
      membershipId: null,
      roleKey: "lead",
    }),
  );
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.save.mockRejectedValueOnce(new Error("refused"));
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        projectId: "p",
        personId: "person",
        membershipId: "row",
        roleKey: "lead",
      }),
    ).rejects.toThrow("refused");
  });
  expect(mocks.refresh).not.toHaveBeenCalled();
});
