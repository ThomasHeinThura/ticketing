import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useDeleteLabel from "./use-delete-label";

const mocks = vi.hoisted(() => ({ del: vi.fn() }));

vi.mock("@taskdesk/libs", () => ({
  client: { label: { ":id": { $delete: mocks.del } } },
}));

let queryClient: QueryClient;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mocks.del.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
});

describe("useDeleteLabel", () => {
  it("requests deletion and leaves every cached label untouched until approval", async () => {
    const labels = [{ id: "label-1", name: "Bug", taskId: null }];
    queryClient.setQueryData(["labels", "workspace-1"], labels);
    mocks.del.mockResolvedValue(
      Response.json({ pendingActionId: "pa-1" }, { status: 202 }),
    );

    const { result } = renderHook(() => useDeleteLabel(), {
      wrapper: Wrapper,
    });

    let requested: unknown;
    await act(async () => {
      requested = await result.current.mutateAsync({ id: "label-1" });
    });

    expect(mocks.del).toHaveBeenCalledWith({ param: { id: "label-1" } });
    expect(requested).toEqual({ pendingActionId: "pa-1" });
    expect(queryClient.getQueryData(["labels", "workspace-1"])).toEqual(labels);
    expect(
      queryClient.getQueryState(["labels", "workspace-1"])?.isInvalidated,
    ).toBe(false);
  });

  it("rejects a direct 200 and a refusal", async () => {
    const { result } = renderHook(() => useDeleteLabel(), {
      wrapper: Wrapper,
    });
    mocks.del.mockResolvedValue(Response.json({ id: "label-1" }));
    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: "label-1" }),
      ).rejects.toMatchObject({ status: 200 });
    });
    mocks.del.mockResolvedValue(new Response("Forbidden", { status: 403 }));
    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: "label-1" }),
      ).rejects.toMatchObject({ status: 403, message: "Forbidden" });
    });
  });
});
