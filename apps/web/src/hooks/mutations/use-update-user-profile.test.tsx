import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import useUpdateUserProfile from "./use-update-user-profile";

const mock = vi.hoisted(() => ({
  update: vi.fn(),
  identity: { id: "u1", session: "s1" },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    updateUser: mock.update,
    getSession: async () => ({
      data: {
        user: { id: mock.identity.id },
        session: { id: mock.identity.session },
      },
      error: null,
    }),
    useSession: () => ({
      data: {
        user: { id: mock.identity.id },
        session: { id: mock.identity.session },
      },
    }),
  },
}));

it("invalidates only the initiating profile history after a successful save", async () => {
  mock.identity = { id: "u1", session: "s1" };
  let finish!: (value: unknown) => void;
  mock.update.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const key = [
    "personal-settings-history",
    window.location.host,
    "profile",
    "u1",
    "s1",
  ];
  client.setQueryData(key, { marker: "old" });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateUserProfile(), { wrapper });
  let pending!: Promise<unknown>;
  act(() => {
    pending = hook.result.current.mutateAsync({ name: "test" });
  });
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalled());
  mock.identity = { id: "u2", session: "s2" };
  hook.rerender();
  await act(async () => {
    finish({ data: {}, error: null });
    await expect(pending).rejects.toThrow("session changed");
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: [
      "personal-settings-history",
      window.location.host,
      "profile",
      "u1",
      "s1",
    ],
    exact: true,
    refetchType: "none",
  });
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).not.toHaveBeenCalledWith({
    queryKey: [
      "personal-settings-history",
      window.location.host,
      "profile",
      "u2",
      "s2",
    ],
    exact: true,
    refetchType: "active",
  });
});

it("does not invalidate profile history on a rejected save", async () => {
  mock.update.mockResolvedValueOnce({ error: { message: "denied" } });
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateUserProfile(), { wrapper });
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ name: "test" }),
    ).rejects.toThrow("denied");
  });
  expect(invalidate).not.toHaveBeenCalled();
});
it("invalidates the exact saved profile on success", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.update.mockResolvedValueOnce({ data: {}, error: null });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateUserProfile(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync({ name: "test" });
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: [
      "personal-settings-history",
      window.location.host,
      "profile",
      "u1",
      "s1",
    ],
    exact: true,
    refetchType: "active",
  });
});
it("finishes a successful save while the active history refresh remains pending", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.update.mockResolvedValueOnce({ data: {}, error: null });
  const client = new QueryClient();
  const key = [
    "personal-settings-history",
    window.location.host,
    "profile",
    "u1",
    "s1",
  ];
  client.setQueryData(key, { rows: [] });
  const fetchHistory = vi.fn(() => new Promise(() => {}));
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: fetchHistory,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const unsubscribe = observer.subscribe(() => {});
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateUserProfile(), { wrapper });
  let result = "pending";
  await act(async () => {
    void hook.result.current.mutateAsync({ name: "saved" }).then(() => {
      result = "saved";
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(result).toBe("saved");
  expect(fetchHistory).toHaveBeenCalledOnce();
  unsubscribe();
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: [
      "personal-settings-history",
      window.location.host,
      "profile",
      "u1",
      "s1",
    ],
    exact: true,
    refetchType: "none",
  });
});
it("replaces the initial pre-save personal history after successive profile writes", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.update.mockReset().mockResolvedValue({ data: {}, error: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const key = [
    "personal-settings-history",
    window.location.host,
    "profile",
    "u1",
    "s1",
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
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateUserProfile(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync({ name: "one" });
    await hook.result.current.mutateAsync({ name: "two" });
  });
  finishOld("old");
  await vi.waitFor(() =>
    expect(observer.getCurrentResult().data).toBe("latest"),
  );
  stop();
  client.clear();
});
