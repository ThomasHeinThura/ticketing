import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCyclesOffered } from "./use-cycle-count";

const mocks = vi.hoisted(() => ({
  project: { id: "p1", kind: "project", slug: "OPS" } as {
    id: string;
    kind: string;
    slug: string;
  },
  cycles: [] as unknown[],
}));

vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [mocks.project] }),
}));
vi.mock("@/fetchers/agile", () => ({
  FeatureDisabledError: class extends Error {},
  getCycles: async () => ({ data: mocks.cycles }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mocks.project = { id: "p1", kind: "project", slug: "OPS" };
  mocks.cycles = [];
});

describe("useCyclesOffered (managed services, 27 Nov 2026)", () => {
  it("offers cycles on a delivery project while the feature is on", () => {
    const { result } = renderHook(() => useCyclesOffered("p1", "w1", true), {
      wrapper,
    });
    expect(result.current).toBe(true);
  });

  it("never offers cycles while the feature is off", () => {
    const { result } = renderHook(() => useCyclesOffered("p1", "w1", false), {
      wrapper,
    });
    expect(result.current).toBe(false);
  });

  it("hides cycles on a managed service that has none", async () => {
    mocks.project = { id: "p1", kind: "managed_service", slug: "SUP" };
    const { result } = renderHook(() => useCyclesOffered("p1", "w1", true), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("keeps cycles on a managed service that still holds old ones", async () => {
    mocks.project = { id: "p1", kind: "managed_service", slug: "SUP" };
    mocks.cycles = [{ id: "c1" }];
    const { result } = renderHook(() => useCyclesOffered("p1", "w1", true), {
      wrapper,
    });
    await waitFor(() => expect(result.current).toBe(true));
  });
});
