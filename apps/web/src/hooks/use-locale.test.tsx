import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useLocale } from "./use-locale";

const mock = vi.hoisted(() => ({
  update: vi.fn(),
  change: vi.fn(),
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
vi.mock("@/lib/i18n", () => ({
  getBrowserLocale: () => "en-US",
  resolveLocale: (value: string) => value,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: "en-US", changeLanguage: mock.change },
  }),
}));

it("invalidates the initiating session after locale save even if the session changes", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.change.mockClear();
  const previousLanguage = document.documentElement.lang;
  let finish!: (value: unknown) => void;
  mock.update.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = new QueryClient();
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
  const hook = renderHook(() => useLocale(), { wrapper });
  let pending!: Promise<void>;
  act(() => {
    pending = hook.result.current.setLocale("en-US");
  });
  await vi.waitFor(() => expect(mock.update).toHaveBeenCalled());
  mock.identity = { id: "u2", session: "s2" };
  hook.rerender();
  await act(async () => {
    finish({ error: null });
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
    refetchType: "active",
  });
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(mock.change).not.toHaveBeenCalled();
  expect(document.documentElement.lang).toBe(previousLanguage);
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

it("does not invalidate after a failed locale save", async () => {
  mock.update.mockResolvedValueOnce({ error: { message: "denied" } });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useLocale(), { wrapper });
  await expect(hook.result.current.setLocale("en-US")).rejects.toThrow(
    "denied",
  );
  expect(invalidate).not.toHaveBeenCalled();
});
it("invalidates the saved profile and changes language on success", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.update.mockResolvedValueOnce({ error: null });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useLocale(), { wrapper });
  await act(async () => {
    await hook.result.current.setLocale("en-US");
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
  expect(mock.change).toHaveBeenCalledWith("en-US");
});
it("applies the saved language without waiting for history refresh", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.update.mockResolvedValueOnce({ error: null });
  mock.change.mockClear();
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
  const hook = renderHook(() => useLocale(), { wrapper });
  let result = "pending";
  await act(async () => {
    void hook.result.current.setLocale("en-US").then(() => {
      result = "saved";
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(result).toBe("saved");
  expect(fetchHistory).toHaveBeenCalledOnce();
  unsubscribe();
  expect(mock.change).toHaveBeenCalledWith("en-US");
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
