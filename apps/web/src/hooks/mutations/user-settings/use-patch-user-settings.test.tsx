import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach as cleanupOffline,
  expect,
  it,
  beforeEach as setupOffline,
  vi,
} from "vitest";
import { usePatchUserSettings } from "./use-patch-user-settings";

const mock = vi.hoisted(() => ({
  patch: vi.fn(),
  getSession: vi.fn(),
  identity: { id: "u1", session: "s1" },
}));
vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: mock.identity.id } }),
}));
vi.mock("@/fetchers/user-settings/user-settings", () => ({
  patchUserSettings: mock.patch,
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: { id: mock.identity.id },
        session: { id: mock.identity.session },
      },
    }),
    getSession: mock.getSession,
  },
}));
function setup() {
  mock.getSession.mockImplementation(async () => ({
    data: {
      user: { id: mock.identity.id },
      session: { id: mock.identity.session },
    },
    error: null,
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    hook: renderHook(() => usePatchUserSettings(), { wrapper }),
  };
}
it("refreshes only captured preferences after successful write and not on failure", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.patch
    .mockReset()
    .mockResolvedValueOnce({ settings: {} })
    .mockRejectedValueOnce(new Error("failed"));
  const { client, hook } = setup();
  const key = [
    "personal-settings-history",
    window.location.host,
    "preferences",
    "u1",
    "s1",
  ];
  client.setQueryData(key, {});
  await act(async () => {
    await hook.result.current.mutateAsync({ density: "compact" });
  });
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ density: "comfortable" }),
    ).rejects.toThrow("failed");
  });
  expect(invalidate).not.toHaveBeenCalled();
});
it("does not block a save on an active stalled history refresh", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.patch.mockReset().mockResolvedValue({ settings: {} });
  const { client, hook } = setup();
  const key = [
    "personal-settings-history",
    window.location.host,
    "preferences",
    "u1",
    "s1",
  ];
  client.setQueryData(key, {});
  const read = vi.fn(() => new Promise(() => {}));
  const observer = new QueryObserver(client, {
    queryKey: key,
    queryFn: read,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const stop = observer.subscribe(() => {});
  await act(async () => {
    await hook.result.current.mutateAsync({ density: "compact" });
  });
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  stop();
  client.clear();
});
it("replaces a delayed pre-save history read after successive preference writes", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.patch.mockReset().mockResolvedValue({ settings: {} });
  const { client, hook } = setup();
  const key = [
    "personal-settings-history",
    window.location.host,
    "preferences",
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
  await waitFor(() => expect(read).toHaveBeenCalledOnce());
  await act(async () => {
    await hook.result.current.mutateAsync({ density: "compact" });
    await hook.result.current.mutateAsync({ density: "comfortable" });
  });
  finishOld("old");
  await waitFor(() => expect(observer.getCurrentResult().data).toBe("latest"));
  stop();
  client.clear();
});
it("keeps the saved target stale without refreshing a new session after a late success", async () => {
  mock.identity = { id: "u1", session: "s1" };
  let finish!: (value: unknown) => void;
  mock.patch.mockReset().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { client, hook } = setup();
  const old = [
    "personal-settings-history",
    window.location.host,
    "preferences",
    "u1",
    "s1",
  ];
  const next = [
    "personal-settings-history",
    window.location.host,
    "preferences",
    "u2",
    "s2",
  ];
  client.setQueryData(old, {});
  client.setQueryData(next, {});
  let pending!: Promise<unknown>;
  act(() => {
    pending = hook.result.current.mutateAsync({ density: "compact" });
  });
  await waitFor(() => expect(mock.patch).toHaveBeenCalled());
  mock.identity = { id: "u2", session: "s2" };
  hook.rerender();
  await act(async () => {
    finish({ settings: {} });
    await pending;
  });
  expect(client.getQueryState(old)?.isInvalidated).toBe(true);
  expect(client.getQueryState(next)?.isInvalidated).toBe(false);
});

setupOffline(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline test")));
});
it("does not write if the captured session changed before sending", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.patch.mockReset();
  const { client, hook } = setup();
  mock.getSession.mockResolvedValueOnce({
    data: { user: { id: "u2" }, session: { id: "s2" } },
    error: null,
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ density: "compact" }),
    ).rejects.toThrow("session changed");
  });
  expect(mock.patch).not.toHaveBeenCalled();
  expect(invalidate).not.toHaveBeenCalled();
});

cleanupOffline(() => vi.unstubAllGlobals());
