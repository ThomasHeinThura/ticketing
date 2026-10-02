import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useGetWorkItem, {
  WORK_ITEM_REFRESH_INTERVAL_MS,
} from "./use-get-work-item";

const getWorkItem = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: (...args: unknown[]) => getWorkItem(...args),
}));

function createTestClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { client, wrapper: Wrapper };
}

afterEach(() => {
  getWorkItem.mockReset();
});

describe("useGetWorkItem refresh", () => {
  it("refetches the active detail at the documented interval to observe another actor's edits", async () => {
    getWorkItem
      .mockResolvedValueOnce({ title: "Before", version: 1 })
      .mockResolvedValueOnce({ title: "Changed by another actor", version: 2 });

    const { client, wrapper } = createTestClient();
    const { result } = renderHook(() => useGetWorkItem({ key: "WLP-1" }), {
      wrapper,
    });

    await waitFor(() =>
      expect(result.current.data).toEqual({ title: "Before", version: 1 }),
    );
    const detailQuery = client
      .getQueryCache()
      .find({ queryKey: ["work-items", "detail", "WLP-1"] });
    expect(
      (detailQuery?.options as { refetchInterval?: number } | undefined)
        ?.refetchInterval,
    ).toBe(WORK_ITEM_REFRESH_INTERVAL_MS);
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() =>
      expect(result.current.data).toEqual({
        title: "Changed by another actor",
        version: 2,
      }),
    );
    expect(result.current.data).toEqual({
      title: "Changed by another actor",
      version: 2,
    });
    expect(getWorkItem).toHaveBeenCalledTimes(2);
  });
});
