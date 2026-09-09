import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useDeleteWorkspace from "./use-delete-workspace";

const mocks = vi.hoisted(() => ({
  del: vi.fn(),
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

  it("falls back to a readable message when the failed response body is EMPTY", async () => {
    // A REGRESSION this pull request introduced and a reviewer caught. The
    // plugin-era code had `error.message || "Failed to delete workspace"`; the
    // cutover dropped the fallback here while the CREATE path kept its own, so
    // the two siblings diverged.
    //
    // An empty non-2xx body is reachable: a reverse-proxy 502/504 never reaches
    // Hono's own error handler, which always supplies a message. Without the
    // fallback that becomes `new Error("")`, and general.tsx's
    // `error instanceof Error ? error.message : t(...)` shows a BLANK toast —
    // the untranslated worst case, because the empty string is still an Error.
    mocks.del.mockResolvedValue({ ok: false, text: async () => "" });

    const { result } = renderHook(() => useDeleteWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({ workspaceId: "workspace-1" }),
      ).rejects.toThrow("Failed to delete workspace");
    });
  });
});
