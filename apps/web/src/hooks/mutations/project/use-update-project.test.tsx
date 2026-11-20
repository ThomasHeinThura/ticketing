import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import useUpdateProject from "./use-update-project";

const update = vi.hoisted(() => vi.fn());
vi.mock("@/fetchers/project/update-project", () => ({
  updateProjectForSession: update,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "user-1" }, session: { id: "session-1" } },
    }),
    getSession: async () => ({
      data: { user: { id: "user-1" }, session: { id: "session-1" } },
      error: null,
    }),
  },
}));
it("invalidates only the saved project's history after success", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  update.mockResolvedValueOnce({});
  const { result } = renderHook(() => useUpdateProject(), { wrapper });
  await act(async () => {
    await result.current.mutateAsync({
      id: "p-1",
      name: "Name",
      slug: "PR",
      description: "",
      icon: "Layout",
    });
  });
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ id: "p-1" }),
    "session-1",
  );
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: [
      "settings-history",
      "project",
      "p-1",
      "agent",
      "user-1",
      "session-1",
    ],
    exact: true,
    refetchType: "none",
  });
  update.mockRejectedValueOnce(new Error("failed"));
  invalidate.mockClear();
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        id: "p-2",
        name: "Name",
        slug: "PR",
        description: "",
        icon: "Layout",
      }),
    ).rejects.toThrow();
  });
  expect(invalidate).not.toHaveBeenCalled();
});

it.each(["pending", "failed"])(
  "settles the committed save when history is %s",
  async (state) => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    vi.spyOn(client, "invalidateQueries").mockImplementation(() =>
      state === "pending"
        ? new Promise(() => {})
        : Promise.reject(new Error("history failed")),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    update.mockResolvedValueOnce({});
    const { result } = renderHook(() => useUpdateProject(), { wrapper });
    let settled = false;
    act(() => {
      void result.current
        .mutateAsync({
          id: "p-1",
          name: "Name",
          slug: "PR",
          description: "",
          icon: "Layout",
        })
        .then(
          () => {
            settled = true;
          },
          () => {},
        );
    });
    await waitFor(() => expect(settled).toBe(true));
  },
);

it("does not wait for an active history query to refetch", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchHistory = vi.fn(() => new Promise<unknown>(() => {}));
  const observer = new QueryObserver(client, {
    queryKey: [
      "settings-history",
      "project",
      "p-1",
      "agent",
      "user-1",
      "session-1",
    ],
    queryFn: fetchHistory,
    initialData: {},
    staleTime: Number.POSITIVE_INFINITY,
  });
  const unsubscribe = observer.subscribe(() => {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  update.mockResolvedValueOnce({});
  const { result } = renderHook(() => useUpdateProject(), { wrapper });
  let settled = false;
  act(() => {
    void result.current
      .mutateAsync({
        id: "p-1",
        name: "Name",
        slug: "PR",
        description: "",
        icon: "Layout",
      })
      .then(() => {
        settled = true;
      });
  });
  await waitFor(() => expect(fetchHistory).toHaveBeenCalledOnce());
  await waitFor(() => expect(settled).toBe(true));
  unsubscribe();
  client.clear();
});
it("replaces an initial pre-save history read after successive project writes", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const key = [
    "settings-history",
    "project",
    "p-1",
    "agent",
    "user-1",
    "session-1",
  ];
  let finishOld!: (value: string) => void;
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue("latest");
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: read,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const stop = observer.subscribe(() => {});
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateProject(), { wrapper });
  update.mockResolvedValue({});
  await act(async () => {
    await hook.result.current.mutateAsync({ id: "p-1", name: "one" });
    await hook.result.current.mutateAsync({ id: "p-1", name: "two" });
  });
  finishOld("old");
  await waitFor(() => expect(observer.getCurrentResult().data).toBe("latest"));
  stop();
  client.clear();
});
