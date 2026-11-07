import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import useAgileFeatures from "@/hooks/queries/agile/use-agile-features";
import { useProjectFeatureState } from "@/hooks/queries/feature-flag/use-project-pages-feature";
import { useTimeTrackingFeatures } from "./use-time-tracking";

const getResolvedFeatures = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/agile", () => ({
  getResolvedFeatures: (projectId: string) => getResolvedFeatures(projectId),
}));

function wrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useTimeTrackingFeatures", () => {
  it("shares the project's one resolved-switch read with the agile and page switches", async () => {
    getResolvedFeatures.mockResolvedValue([
      { key: "feature.time_tracking", enabled: true },
      { key: "feature.cost_tracking", enabled: true },
      { key: "feature.cycles", enabled: true },
      { key: "feature.pages", enabled: false },
    ]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // The work item detail mounts all three on one screen.
    const { result } = renderHook(
      () => ({
        time: useTimeTrackingFeatures("p1"),
        agile: useAgileFeatures("p1"),
        pages: useProjectFeatureState("p1", "feature.pages"),
      }),
      { wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(result.current.time.time).toBe(true));
    expect(result.current.time.cost).toBe(true);
    expect(result.current.agile.features.cycles).toBe(true);
    expect(result.current.pages).toBe(false);
    // Before this change: 2 requests (the Time switches had their own cache key).
    expect(getResolvedFeatures).toHaveBeenCalledTimes(1);
  });

  it("follows the feature settings panel's refresh of the shared switches", async () => {
    getResolvedFeatures.mockReset();
    getResolvedFeatures.mockResolvedValueOnce([
      { key: "feature.time_tracking", enabled: false },
    ]);
    getResolvedFeatures.mockResolvedValueOnce([
      { key: "feature.time_tracking", enabled: true },
    ]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useTimeTrackingFeatures("p1"), {
      wrapper: wrapper(queryClient),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.time).toBe(false);

    await queryClient.invalidateQueries({ queryKey: ["agile", "features"] });
    await waitFor(() => expect(result.current.time).toBe(true));
    expect(getResolvedFeatures).toHaveBeenCalledTimes(2);
  });

  it("stays off and reads nothing without a project", () => {
    getResolvedFeatures.mockReset();
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useTimeTrackingFeatures(undefined), {
      wrapper: wrapper(queryClient),
    });
    expect(result.current.time).toBe(false);
    expect(result.current.cost).toBe(false);
    expect(getResolvedFeatures).not.toHaveBeenCalled();
  });
});
