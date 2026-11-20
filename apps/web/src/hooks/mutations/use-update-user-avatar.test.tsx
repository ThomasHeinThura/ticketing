import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import useRemoveUserAvatar from "./use-remove-user-avatar";
import useUpdateUserAvatar from "./use-update-user-avatar";

const mock = vi.hoisted(() => ({
  update: vi.fn(),
  getSession: vi.fn(),
  remove: vi.fn(),
  prep: vi.fn(async () => ({ contentType: "image/png", data: "synthetic" })),
  upload: vi.fn(async () => ({ url: "synthetic" })),
  audited: vi.fn(),
  identity: { id: "u1", session: "s1" },
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    updateUser: mock.update,
    getSession: mock.getSession.mockImplementation(async () => ({
      data: {
        user: { id: mock.identity.id },
        session: { id: mock.identity.session },
      },
      error: null,
    })),
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
function mount<T>(useHook: () => T) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _context, mutation) =>
        mock.audited(
          mutation.meta?.audits?.targets(variables as never, data as never),
        ),
    }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(useHook, { wrapper });
}
const profileTarget = [{ kind: "self", audience: "staff", section: "profile" }];

for (const mode of ["add", "remove"] as const) {
  it(`audits a committed avatar ${mode} even if the session then changes`, async () => {
    mock.identity = { id: "u1", session: "s1" };
    mock.audited.mockClear();
    mock.update.mockReset();
    let finish!: (value: unknown) => void;
    mock.update.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mock.remove.mockResolvedValue(undefined);
    const hook = mount(() => ({
      add: useUpdateUserAvatar(),
      remove: useRemoveUserAvatar(),
    }));
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
    expect(mock.audited).toHaveBeenCalledOnce();
    expect(mock.audited).toHaveBeenCalledWith(profileTarget);
  });
}

for (const stage of ["prep", "upload", "profile"] as const) {
  it(`does not audit a failed avatar ${stage}`, async () => {
    mock.identity = { id: "u1", session: "s1" };
    mock.audited.mockClear();
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
    const hook = mount(() => useUpdateUserAvatar());
    await act(async () => {
      await expect(
        hook.result.current.mutateAsync(new File([], "a.png")),
      ).rejects.toThrow("failed");
    });
    expect(mock.audited).not.toHaveBeenCalled();
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
  const hook = mount(() => useUpdateUserAvatar());
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
  const hook = mount(() => useUpdateUserAvatar());
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
it("audits a successful image clear even when file deletion fails", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.audited.mockClear();
  mock.update.mockReset().mockResolvedValue({ error: null });
  mock.remove.mockReset().mockRejectedValue(new Error("deletion failed"));
  const hook = mount(() => useRemoveUserAvatar());
  await act(async () => {
    await expect(hook.result.current.mutateAsync()).rejects.toThrow(
      "deletion failed",
    );
  });
  expect(mock.audited).toHaveBeenCalledWith(profileTarget);
});

it("audits a successful avatar upload once", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.audited.mockClear();
  mock.prep
    .mockReset()
    .mockResolvedValue({ contentType: "image/png", data: "synthetic" });
  mock.upload.mockReset().mockResolvedValue({ url: "synthetic" });
  mock.update.mockReset().mockResolvedValue({ error: null });
  const hook = mount(() => useUpdateUserAvatar());
  await act(async () => {
    await hook.result.current.mutateAsync(new File([], "a.png"));
  });
  expect(mock.audited).toHaveBeenCalledOnce();
  expect(mock.audited).toHaveBeenCalledWith(profileTarget);
});

it("checks the session only at required save boundaries", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.getSession.mockClear();
  mock.update.mockReset().mockResolvedValue({ error: null });
  mock.prep
    .mockReset()
    .mockResolvedValue({ contentType: "image/png", data: "synthetic" });
  mock.upload.mockReset().mockResolvedValue({ url: "synthetic" });
  const hook = mount(() => useUpdateUserAvatar());
  await act(async () => {
    await hook.result.current.mutateAsync(new File([], "a.png"));
  });
  expect(mock.getSession).toHaveBeenCalledTimes(4);
});
