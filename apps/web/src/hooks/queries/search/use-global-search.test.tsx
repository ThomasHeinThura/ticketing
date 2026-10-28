import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useGlobalSearch from "./use-global-search";

const mocks = vi.hoisted(() => ({ globalSearch: vi.fn() }));

vi.mock("@/fetchers/search/global-search", () => ({
  default: mocks.globalSearch,
}));

afterEach(() => vi.clearAllMocks());

describe("useGlobalSearch cancellation", () => {
  it("passes TanStack Query's abort signal to the search fetcher", async () => {
    mocks.globalSearch.mockImplementation(
      (_params: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    renderHook(
      () =>
        useGlobalSearch({
          q: "TaskDeskPerf",
          workspaceId: "workspace-1",
        }),
      { wrapper },
    );

    await waitFor(() => expect(mocks.globalSearch).toHaveBeenCalledOnce());
    const signal = mocks.globalSearch.mock.calls[0][1] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);

    await act(async () => {
      await queryClient.cancelQueries({ queryKey: ["search"] });
    });

    expect(signal.aborted).toBe(true);
    queryClient.clear();
  });
});
