import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import useRemoveUserAvatar from "./use-remove-user-avatar";
import useUpdateUserAvatar from "./use-update-user-avatar";

const mock = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  prep: vi.fn(async () => ({ contentType: "image/png", data: "synthetic" })),
  upload: vi.fn(async () => ({ url: "synthetic" })),
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
vi.mock("@/fetchers/user/upload-avatar", () => ({
  default: mock.upload,
}));
vi.mock("@/fetchers/user/delete-avatar", () => ({ default: mock.remove }));
vi.mock("@/lib/prepare-avatar-image", () => ({
  prepareAvatarImage: mock.prep,
}));
for (const mode of ["add", "remove"] as const) {
  it(`invalidates the initiating session after avatar ${mode}`, async () => {
    mock.identity = { id: "u1", session: "s1" };
    mock.update.mockReset();
    let finish!: (value: unknown) => void;
    mock.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mock.remove.mockResolvedValue(undefined);
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
    const hook = renderHook(
      () => {
        const add = useUpdateUserAvatar();
        const remove = useRemoveUserAvatar();
        return { add, remove };
      },
      { wrapper },
    );
    let pending!: Promise<unknown>;
    act(() => {
      pending =
        mode === "add"
          ? hook.result.current.add.mutateAsync(new File([], "a.png"))
          : hook.result.current.remove.mutateAsync();
    });
    await vi.waitFor(() => expect(mock.update).toHaveBeenCalled());
    mock.identity = { id: "u2", session: "s2" };
    hook.rerender();
    await act(async () => {
      finish({ error: null });
      await expect(pending).rejects.toThrow("session changed");
    });
    if (mode === "remove") expect(mock.remove).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(1);
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
}

for (const stage of ["prep", "upload", "profile"] as const) {
  it(`does not report or invalidate a failed avatar ${stage}`, async () => {
    mock.identity = { id: "u1", session: "s1" };
    mock.prep
      .mockReset()
      .mockResolvedValue({ contentType: "image/png", data: "synthetic" });
    mock.upload.mockReset().mockResolvedValue({ url: "synthetic" });
    mock.update.mockReset().mockResolvedValue({ error: null });
    if (stage === "prep") mock.prep.mockRejectedValueOnce(new Error("failed"));
    if (stage === "upload")
      mock.upload.mockRejectedValueOnce(new Error("failed"));
    if (stage === "profile")
      mock.update.mockResolvedValueOnce({ error: { message: "failed" } });
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useUpdateUserAvatar(), { wrapper });
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync(new File([], "a.png")),
      ).rejects.toThrow("failed");
    });
    expect(invalidate).not.toHaveBeenCalled();
  });
}
it("does not write a profile after a session switch during upload", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.prep
    .mockReset()
    .mockResolvedValue({ contentType: "image/png", data: "synthetic" });
  mock.update.mockReset();
  let finish!: (value: { url: string }) => void;
  mock.upload.mockReset().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateUserAvatar(), { wrapper });
  let pending!: Promise<unknown>;
  act(() => {
    pending = hook.result.current.mutateAsync(new File([], "a.png"));
  });
  await vi.waitFor(() => expect(mock.upload).toHaveBeenCalled());
  mock.identity = { id: "u2", session: "s2" };
  await act(async () => {
    finish({ url: "synthetic" });
    await expect(pending).rejects.toThrow("session changed");
  });
  expect(mock.update).not.toHaveBeenCalled();
});
it("does not upload after a session switch during preparation", async () => {
  mock.identity = { id: "u1", session: "s1" };
  let finish!: (value: { contentType: string; data: string }) => void;
  mock.prep.mockReset().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mock.upload.mockReset();
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateUserAvatar(), { wrapper });
  let pending!: Promise<unknown>;
  act(() => {
    pending = hook.result.current.mutateAsync(new File([], "a.png"));
  });
  await vi.waitFor(() => expect(mock.prep).toHaveBeenCalled());
  mock.identity = { id: "u2", session: "s2" };
  await act(async () => {
    finish({ contentType: "image/png", data: "synthetic" });
    await expect(pending).rejects.toThrow("session changed");
  });
  expect(mock.upload).not.toHaveBeenCalled();
});
it("invalidates a successful image clear even when file deletion fails", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.update.mockReset().mockResolvedValue({ error: null });
  mock.remove.mockReset().mockRejectedValue(new Error("deletion failed"));
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useRemoveUserAvatar(), { wrapper });
  await act(async () => {
    await expect(hook.result.current.mutateAsync()).rejects.toThrow(
      "deletion failed",
    );
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
});
it("invalidates exact profile history after a successful avatar upload", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.prep
    .mockReset()
    .mockResolvedValue({ contentType: "image/png", data: "synthetic" });
  mock.upload.mockReset().mockResolvedValue({ url: "synthetic" });
  mock.update.mockReset().mockResolvedValue({ error: null });
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useUpdateUserAvatar(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync(new File([], "a.png"));
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
for (const mode of ["add", "remove"] as const) {
  it(`finishes avatar ${mode} without waiting for history refresh`, async () => {
    mock.identity = { id: "u1", session: "s1" };
    mock.update.mockReset().mockResolvedValue({ error: null });
    mock.prep
      .mockReset()
      .mockResolvedValue({ contentType: "image/png", data: "synthetic" });
    mock.upload.mockReset().mockResolvedValue({ url: "synthetic" });
    mock.remove.mockReset().mockResolvedValue(undefined);
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
    const hook = renderHook(
      () => {
        const add = useUpdateUserAvatar();
        const remove = useRemoveUserAvatar();
        return { add, remove };
      },
      { wrapper },
    );
    let result = "pending";
    await act(async () => {
      void (
        mode === "add"
          ? hook.result.current.add.mutateAsync(new File([], "a.png"))
          : hook.result.current.remove.mutateAsync()
      ).then(() => {
        result = "saved";
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(result).toBe("saved");
    expect(fetchHistory).toHaveBeenCalledOnce();
    unsubscribe();
    if (mode === "remove") expect(mock.remove).toHaveBeenCalledOnce();
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
}
