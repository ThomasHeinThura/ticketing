import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import useUpdateProject from "./use-update-project";

const update = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/project/update-project", () => ({
  updateProjectForSession: update,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "user-1" }, session: { id: "session-1" } },
    }),
  },
}));

it("saves for the current session and declares the saved project as the audited History target", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  update.mockResolvedValueOnce({ id: "p-1", workspaceId: "ws-1" });
  const { result } = renderHook(() => useUpdateProject(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({ id: "p-1", name: "Name" });
  });
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ id: "p-1" }),
    "session-1",
  );
  const mutation = client.getMutationCache().getAll()[0];
  expect(
    mutation?.meta?.audits?.targets(
      mutation.state.variables as never,
      mutation.state.data as never,
    ),
  ).toEqual([
    {
      kind: "entity",
      type: "project",
      id: "p-1",
      scope: { kind: "project", workspaceId: "ws-1", projectId: "p-1" },
    },
  ]);
});
