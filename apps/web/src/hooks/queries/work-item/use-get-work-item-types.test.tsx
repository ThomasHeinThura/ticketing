import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useGetWorkItemTypes from "./use-get-work-item-types";

const mocks = vi.hoisted(() => ({ getTypes: vi.fn() }));

vi.mock("@/fetchers/work-item/get-work-item-types", () => ({
  default: mocks.getTypes,
}));

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

beforeEach(() => {
  mocks.getTypes.mockReset();
  mocks.getTypes.mockResolvedValue([]);
});

describe("useGetWorkItemTypes", () => {
  it("keys the cache per workspace, so one workspace's types can never be served for another", async () => {
    const client = createClient();
    const wrapper = wrapperFor(client);

    const first = renderHook(
      () => useGetWorkItemTypes({ workspaceId: "ws-a" }),
      { wrapper },
    );
    await waitFor(() => expect(first.result.current.data).toEqual([]));

    const second = renderHook(
      () => useGetWorkItemTypes({ workspaceId: "ws-b" }),
      { wrapper },
    );
    await waitFor(() => expect(second.result.current.data).toEqual([]));

    expect(mocks.getTypes).toHaveBeenCalledWith("ws-a");
    expect(mocks.getTypes).toHaveBeenCalledWith("ws-b");
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([
      ["work-item-types", "ws-a"],
      ["work-item-types", "ws-b"],
    ]);
  });

  it("does not fetch without a workspace id", () => {
    const client = createClient();
    const { result } = renderHook(
      () => useGetWorkItemTypes({ workspaceId: undefined }),
      { wrapper: wrapperFor(client) },
    );

    // react-query still registers a store entry for a disabled query; what must hold is
    // that nothing was fetched and the query never left idle.
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
    expect(mocks.getTypes).not.toHaveBeenCalled();
  });
});
