import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getProjects } = vi.hoisted(() => ({ getProjects: vi.fn() }));
vi.mock("@/fetchers/project/get-projects", () => ({ default: getProjects }));

import useGetProjects from "./use-get-projects";

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("useGetProjects", () => {
  beforeEach(() => {
    getProjects.mockReset();
    getProjects.mockResolvedValue([{ id: "project-1", slug: "HELP" }]);
  });

  it("asks once when callers spell the default list differently", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () => ({
        sidebar: useGetProjects({ workspaceId: "workspace-1" }),
        page: useGetProjects({
          workspaceId: "workspace-1",
          includeArchived: false,
          includeDeleted: false,
        }),
      }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => {
      expect(result.current.sidebar.data).toHaveLength(1);
      expect(result.current.page.data).toHaveLength(1);
    });
    expect(getProjects).toHaveBeenCalledTimes(1);
    // The work list's route prefetch writes the same entry (lib/work-list-prefetch.ts).
    expect(
      client.getQueryData(["projects", "workspace-1", undefined, undefined]),
    ).toHaveLength(1);
  });

  it("keeps the recovery list (archived and deleted) as its own read", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () => ({
        sidebar: useGetProjects({ workspaceId: "workspace-1" }),
        recovery: useGetProjects({
          workspaceId: "workspace-1",
          includeArchived: true,
          includeDeleted: true,
        }),
      }),
      { wrapper: wrapperFor(client) },
    );
    await waitFor(() => {
      expect(result.current.sidebar.isSuccess).toBe(true);
      expect(result.current.recovery.isSuccess).toBe(true);
    });
    expect(getProjects).toHaveBeenCalledTimes(2);
    expect(getProjects).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      includeArchived: "true",
      includeDeleted: "true",
    });
  });
});
