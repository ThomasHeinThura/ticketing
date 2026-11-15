import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type getProjects from "@/fetchers/project/get-projects";
import reorderProjects from "@/fetchers/project/reorder-projects";
import { projectsOptions } from "@/hooks/queries/project/use-get-projects";
import useReorderProjects from "./use-reorder-projects";

vi.mock("@/fetchers/project/reorder-projects", () => ({
  default: vi.fn(),
}));

type ProjectList = NonNullable<Awaited<ReturnType<typeof getProjects>>>;

const makeProjects = (): ProjectList =>
  [
    { id: "proj-1", slug: "SUP", name: "Support", position: 0 },
    { id: "proj-2", slug: "WEB", name: "Website", position: 1 },
  ] as unknown as ProjectList;

function createSetup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useReorderProjects", () => {
  beforeEach(() => {
    vi.mocked(reorderProjects).mockReset();
  });

  it("optimistically updates and cancels under projectsOptions(workspaceId).queryKey and invalidates workspace projects on settle", async () => {
    let resolveMutation!: () => void;
    vi.mocked(reorderProjects).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMutation = () => resolve(undefined as never);
        }),
    );

    const { queryClient, wrapper } = createSetup();
    const initialProjects = makeProjects();
    const exactKey = projectsOptions("workspace-1").queryKey;
    const archivedKey = projectsOptions(
      "workspace-1",
      true,
      undefined,
    ).queryKey;

    queryClient.setQueryData(exactKey, initialProjects);
    queryClient.setQueryData(archivedKey, initialProjects);

    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useReorderProjects(), { wrapper });

    const reordered = [...initialProjects].reverse();
    act(() => {
      result.current("workspace-1", reordered);
    });

    expect(queryClient.getQueryData<ProjectList>(exactKey)).toEqual([
      { ...initialProjects[1], position: 0 },
      { ...initialProjects[0], position: 1 },
    ]);
    expect(
      queryClient.getQueryData(["projects", "workspace-1"]),
    ).toBeUndefined();
    expect(cancelSpy).toHaveBeenCalledWith({ queryKey: exactKey });
    await waitFor(() => {
      expect(reorderProjects).toHaveBeenCalledWith("workspace-1", [
        { id: "proj-2", position: 0 },
        { id: "proj-1", position: 1 },
      ]);
    });

    await act(async () => {
      resolveMutation();
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["projects", "workspace-1"],
      });
    });
    expect(queryClient.getQueryState(exactKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(archivedKey)?.isInvalidated).toBe(true);
  });

  it("rolls back to previousProjects under projectsOptions(workspaceId).queryKey when reorderProjects rejects", async () => {
    vi.mocked(reorderProjects).mockRejectedValueOnce(
      new Error("network error"),
    );

    const { queryClient, wrapper } = createSetup();
    const previousProjects = makeProjects();
    const exactKey = projectsOptions("workspace-1").queryKey;

    queryClient.setQueryData(exactKey, previousProjects);

    const { result } = renderHook(() => useReorderProjects(), { wrapper });

    const reordered = [...previousProjects].reverse();
    const onError = vi.fn();
    act(() => {
      result.current("workspace-1", reordered, { onError });
    });

    await waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });

    expect(queryClient.getQueryData<ProjectList>(exactKey)).toEqual(
      previousProjects,
    );
    expect(
      queryClient.getQueryData(["projects", "workspace-1"]),
    ).toBeUndefined();
  });
});
