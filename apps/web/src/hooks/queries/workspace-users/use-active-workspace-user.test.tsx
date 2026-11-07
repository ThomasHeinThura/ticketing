import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGetActiveWorkspaceUser } from "./use-active-workspace-user";
import { useGetActiveWorkspaceUsers } from "./use-get-active-workspace-users";

const membersGet = vi.hoisted(() => vi.fn());

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: { ":workspaceId": { members: { $get: membersGet } } },
  },
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "w1" } }),
}));

const row = (role: string) => ({
  id: "u1",
  personId: "p1",
  role,
  name: "Ann",
  email: "ann@example.test",
  image: null,
});

function respond(role: string) {
  return {
    ok: true,
    json: async () => [row(role), { ...row("member"), id: "u2" }],
  };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useGetActiveWorkspaceUser", () => {
  beforeEach(() => {
    membersGet.mockReset();
  });

  it("shares one members read with the members list the detail's activity reads", async () => {
    membersGet.mockResolvedValue(respond("admin"));
    const { wrapper } = setup();
    // The permission check and the activity/audit list mount on one screen.
    const { result } = renderHook(
      () => ({
        me: useGetActiveWorkspaceUser(),
        list: useGetActiveWorkspaceUsers("w1"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.me.data?.role).toBe("admin"));
    await waitFor(() => expect(result.current.list.data).toBeDefined());
    expect(result.current.me.data).toMatchObject({ id: "u1", personId: "p1" });
    // Before this change: 2 requests (one per cache key).
    expect(membersGet).toHaveBeenCalledTimes(1);
  });

  it("re-reads from the server when a role change refreshes it, and updates the shared list", async () => {
    membersGet.mockResolvedValueOnce(respond("member"));
    membersGet.mockResolvedValueOnce(respond("admin"));
    const { queryClient, wrapper } = setup();
    const { result } = renderHook(() => useGetActiveWorkspaceUser(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data?.role).toBe("member"));

    // What use-update-workspace-user-role.ts and use-transfer-workspace-ownership.ts invalidate.
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: ["workspace-user", "active"],
      });
    });
    await waitFor(() => expect(result.current.data?.role).toBe("admin"));
    expect(membersGet).toHaveBeenCalledTimes(2);
    expect(
      queryClient.getQueryData<{ members: Array<{ role: string }> }>([
        "active-workspace-users",
        "w1",
      ])?.members[0]?.role,
    ).toBe("admin");
  });

  it("answers null when the caller has no row", async () => {
    membersGet.mockResolvedValue({
      ok: true,
      json: async () => [{ ...row("member"), id: "u2" }],
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useGetActiveWorkspaceUser(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
