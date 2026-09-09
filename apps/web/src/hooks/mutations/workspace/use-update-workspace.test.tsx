import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useUpdateWorkspace from "./use-update-workspace";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      ":workspaceId": {
        $patch: mocks.patch,
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

describe("useUpdateWorkspace", () => {
  beforeEach(() => {
    mocks.patch.mockReset();
    mocks.refresh.mockReset();
    mocks.patch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-1" }),
    });
  });

  it("auto-derives a slug from the new name when no slug is given, preserving prior client behaviour", async () => {
    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId: "workspace-1",
        name: "Brand New Name",
      });
    });

    expect(mocks.patch).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
      json: { name: "Brand New Name", slug: "brand-new-name" },
    });
  });

  it("does not override an explicitly supplied slug", async () => {
    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId: "workspace-1",
        name: "Brand New Name",
        slug: "kept-slug",
      });
    });

    expect(mocks.patch).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
      json: { name: "Brand New Name", slug: "kept-slug" },
    });
  });

  it("sends only description when only description changes", async () => {
    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId: "workspace-1",
        description: "Updated",
      });
    });

    expect(mocks.patch).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
      json: { description: "Updated" },
    });
  });

  it("throws the response body text when the request fails", async () => {
    mocks.patch.mockResolvedValue({
      ok: false,
      text: async () => "That workspace slug is already taken",
    });

    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          workspaceId: "workspace-1",
          name: "Name",
        }),
      ).rejects.toThrow("already taken");
    });
  });

  it("refreshes the plugin's workspace stores after a successful native PATCH", async () => {
    // The regression this guards was found in a browser, not by a unit test:
    // after a successful `PATCH /api/workspace/{id}` the settings sidebar and
    // the delete-confirmation dialog both still showed the PREVIOUS name,
    // because `use-active-workspace`/`use-get-workspaces` read better-auth's
    // nanostores and those are refreshed only by the plugin's own
    // `atomListeners`, which match on PLUGIN route paths. The native route hits
    // none, so nothing invalidated them.
    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId: "workspace-1",
        name: "Renamed",
      });
    });

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("does NOT refresh the stores when the native PATCH fails", async () => {
    // Fail-closed on the display side too: a refused write must not make the
    // UI re-read as though something had changed.
    mocks.patch.mockResolvedValue({
      ok: false,
      text: async () => "Forbidden",
    });

    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          workspaceId: "workspace-1",
          name: "Renamed",
        }),
      ).rejects.toThrow("Forbidden");
    });

    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
