import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import useUpdateWorkspaceUserRole from "./use-update-workspace-user-role";

const save = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/workspace-user/update-workspace-member-role", () => ({
  default: save,
}));

it("declares the saved membership row as the History target and never sends it to the API", async () => {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  save.mockResolvedValue({});
  const { result } = renderHook(() => useUpdateWorkspaceUserRole(), {
    wrapper,
  });
  const variables = {
    workspaceId: "w",
    userId: "target-user",
    workspaceMemberId: "row",
    role: "admin",
  };
  await act(() => result.current.mutateAsync(variables));
  expect(save).toHaveBeenCalledWith({
    workspaceId: "w",
    userId: "target-user",
    role: "admin",
  });
  const audits = client.getMutationCache().getAll()[0]?.options.meta?.audits;
  expect(audits?.targets(variables as never, {} as never)).toEqual([
    {
      kind: "entity",
      type: "workspace_member",
      id: "row",
      scope: { kind: "workspace", workspaceId: "w" },
    },
  ]);
  expect(
    audits?.targets(
      { ...variables, workspaceMemberId: null } as never,
      {} as never,
    ),
  ).toEqual([]);
});
