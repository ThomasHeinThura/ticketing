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

  // A slug is part of already-shared URLs (see the comment on
  // updateWorkspace in apps/api/src/workspace/controllers/update-workspace.ts,
  // around line 20). Renaming must NOT re-derive it — a name-only rename has
  // to send no `slug` key at all, and the workspace's slug must stay put.
  // This replaces a pre-existing test that asserted the opposite (the
  // defect: every rename silently moved the slug too).
  it("sends no slug key when only the name changes, and the slug does not move", async () => {
    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId: "workspace-1",
        name: "Brand New Name",
      });
    });

    const [[body]] = mocks.patch.mock.calls;
    expect(body).toEqual({
      param: { workspaceId: "workspace-1" },
      json: { name: "Brand New Name" },
    });
    expect(body.json).not.toHaveProperty("slug");
  });

  it("changes the slug when a slug is explicitly supplied", async () => {
    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({
        workspaceId: "workspace-1",
        slug: "new-explicit-slug",
      });
    });

    expect(mocks.patch).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
      json: { slug: "new-explicit-slug" },
    });
  });

  it("does not override an explicitly supplied slug with a derived one when name and slug are both given", async () => {
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

    // Both keys are sent, and the explicit slug wins — it is never
    // recomputed from `name` and overwritten.
    expect(mocks.patch).toHaveBeenCalledWith({
      param: { workspaceId: "workspace-1" },
      json: { name: "Brand New Name", slug: "kept-slug" },
    });
  });

  it("cannot hit slug-collision behaviour on a name-only rename, only on an explicit slug change", async () => {
    // Simulate a server that rejects any request carrying a `slug` key as a
    // collision, regardless of value. A name-only rename must never reach
    // that path because it must never carry a `slug` key in the first
    // place; an explicit slug change must still reach it.
    mocks.patch.mockImplementation(async ({ json }) => {
      if ("slug" in json) {
        return { ok: false, text: async () => "Slug already taken" };
      }
      return { ok: true, json: async () => ({ id: "workspace-1" }) };
    });

    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          workspaceId: "workspace-1",
          name: "Totally Fine Rename",
        }),
      ).resolves.toEqual({ id: "workspace-1" });
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          workspaceId: "workspace-1",
          slug: "colliding-slug",
        }),
      ).rejects.toThrow("already taken");
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

  it("falls back to a readable message when the failed response body is EMPTY", async () => {
    // A REGRESSION this pull request introduced and a reviewer caught. The
    // plugin-era code had `error.message || "Failed to update workspace"`; the
    // cutover dropped the fallback here while the CREATE path kept its own, so
    // the two siblings diverged.
    //
    // An empty non-2xx body is reachable: a reverse-proxy 502/504 never reaches
    // Hono's own error handler, which always supplies a message. Without the
    // fallback that becomes `new Error("")`, and general.tsx's
    // `error instanceof Error ? error.message : t(...)` shows a BLANK toast —
    // the untranslated worst case, because the empty string is still an Error.
    mocks.patch.mockResolvedValue({ ok: false, text: async () => "" });

    const { result } = renderHook(() => useUpdateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await expect(
        result.current.mutateAsync({
          workspaceId: "workspace-1",
          name: "Renamed",
        }),
      ).rejects.toThrow("Failed to update workspace");
    });
  });
});
