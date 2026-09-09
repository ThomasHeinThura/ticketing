import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useDeleteWorkspace from "./use-delete-workspace";

const mocks = vi.hoisted(() => ({
  del: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      ":workspaceId": {
        $delete: mocks.del,
      },
    },
  },
}));

// The S4b store-refresh shim is mocked so this file can assert WHETHER it runs.
// Without an assertion the fix would be unprobed: reverting the call leaves the
// rest of this suite green, which is the defect #81's finding C-4 named.
vi.mock("@/lib/utils/refresh-workspace-stores", () => ({
  refreshWorkspaceStores: mocks.refresh,
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useDeleteWorkspace", () => {
  beforeEach(() => {
    mocks.del.mockReset();
    mocks.refresh.mockReset();
  });

  it("deletes via the native workspace route", async () => {
    mocks.del.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-1" }),
    });

    const { result } = renderHook(() => useDeleteWorkspace(), {
      wrapper: createWrapper(),
    });

    let deleted: unknown;
    await act(async () => {
      deleted = await result.current.mutateAsync({
        workspaceId: "workspace-1",
      });
    });

    expect(mocks.del).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
    });
    expect(deleted).toEqual({ id: "workspace-1" });
  });

  it("throws the response body text when the request fails", async () => {
    mocks.del.mockResolvedValue({
      ok: false,
      text: async () => "Workspace not found",
    });

    const { result } = renderHook(() => useDeleteWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ workspaceId: "missing" }),
      ).rejects.toThrow("Workspace not found");
    });
  });

  it("refreshes the plugin's workspace stores after a successful native DELETE", async () => {
    mocks.del.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const { result } = renderHook(() => useDeleteWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ workspaceId: "workspace-1" });
    });

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh the stores when the native DELETE fails", async () => {
    mocks.del.mockResolvedValue({ ok: false, text: async () => "Forbidden" });

    const { result } = renderHook(() => useDeleteWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ workspaceId: "workspace-1" }),
      ).rejects.toThrow("Forbidden");
    });

    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
