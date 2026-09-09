import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useUpdateWorkspace from "./use-update-workspace";

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
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
});
