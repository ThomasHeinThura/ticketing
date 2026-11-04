import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCachedWorkItemProjectId } from "./nav-projects";

const DETAIL_KEY = ["work-items", "detail", "WLP-1"] as const;

describe("sidebar work-item project read", () => {
  let client: QueryClient | undefined;
  afterEach(() => client?.clear());

  it("follows the loaded detail without taking over the page's refetch", async () => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let version = 1;
    const fetchDetail = vi.fn(async () => ({
      key: "WLP-1",
      projectId: "project-1",
      version,
    }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client as QueryClient}>
        {children}
      </QueryClientProvider>
    );
    const { result } = renderHook(
      () => {
        // The page's detail query, then the sidebar mounted after it (as in the shell).
        const page = useQuery({ queryKey: DETAIL_KEY, queryFn: fetchDetail });
        const projectId = useCachedWorkItemProjectId("WLP-1");
        return { page, projectId };
      },
      { wrapper },
    );
    await waitFor(() => expect(result.current.projectId).toBe("project-1"));
    expect(fetchDetail).toHaveBeenCalledTimes(1);

    // A version conflict refreshes the detail: the request must go out and the page must
    // see the new version.
    version = 2;
    await act(() =>
      (client as QueryClient).invalidateQueries({ queryKey: DETAIL_KEY }),
    );
    await waitFor(() => expect(result.current.page.data?.version).toBe(2));
    expect(fetchDetail).toHaveBeenCalledTimes(2);
  });

  it("reads nothing without a work item key", () => {
    client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client as QueryClient}>
        {children}
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useCachedWorkItemProjectId(undefined), {
      wrapper,
    });
    expect(result.current).toBeUndefined();
  });
});
