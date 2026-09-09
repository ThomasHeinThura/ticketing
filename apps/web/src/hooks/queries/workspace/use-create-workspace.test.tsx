import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useCreateWorkspace from "./use-create-workspace";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  list: vi.fn(),
  notify: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@taskdesk/libs", () => ({
  client: {
    workspace: {
      $post: mocks.post,
    },
  },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: {
      list: mocks.list,
    },
    // `refreshWorkspaceStores` notifies the plugin's own nanostore atoms after
    // a native write, because no plugin route path is hit any more and the
    // plugin's `atomListeners` therefore never fire. See
    // `@/lib/utils/refresh-workspace-stores`.
    $store: {
      notify: mocks.notify,
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

describe("useCreateWorkspace", () => {
  beforeEach(() => {
    mocks.post.mockReset();
    mocks.list.mockReset();
    mocks.notify.mockReset();
    mocks.refresh.mockReset();
    mocks.list.mockResolvedValue({ data: [] });
  });

  it("creates via the native workspace route, ignoring plugin-only options", async () => {
    mocks.post.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "workspace-1", name: "Acme" }),
    });

    const { result } = renderHook(() => useCreateWorkspace(), {
      wrapper: createWrapper(),
    });

    let created: unknown;
    await act(async () => {
      created = await result.current.mutateAsync({
        name: "Acme",
        slug: "acme",
        // Plugin-era options: must be accepted (existing call sites still
        // pass them) but must NOT change what is sent to the native route.
        keepCurrentActiveOrganization: true,
        userId: "user-1",
      });
    });

    expect(mocks.post).toHaveBeenCalledWith({
      json: {
        name: "Acme",
        slug: "acme",
        logo: undefined,
        description: undefined,
      },
    });
    expect(created).toEqual({ id: "workspace-1", name: "Acme" });
  });

  it("retries with a new slug on a 409 slug collision when no slug was supplied", async () => {
    mocks.post
      .mockResolvedValueOnce({
        ok: false,
        text: async () => "That workspace slug is already taken",
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "workspace-2" }),
      });

    const { result } = renderHook(() => useCreateWorkspace(), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: "Acme" });
    });

    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});
