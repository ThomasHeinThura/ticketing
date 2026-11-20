import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import useUpdateUserProfile from "./use-update-user-profile";

const mock = vi.hoisted(() => ({
  update: vi.fn(),
  getSession: vi.fn(),
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

function mount() {
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
  return {
    client,
    hook: renderHook(() => useUpdateUserProfile(), { wrapper }),
  };
}

it("declares the profile History target and audits a committed save even if the session then changes", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.audited.mockClear();
  let finish!: (value: unknown) => void;
  mock.update.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { hook } = mount();
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
  expect(mock.audited).toHaveBeenCalledWith([
    { kind: "self", audience: "staff", section: "profile" },
  ]);
});

it("does not audit a rejected save", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.audited.mockClear();
  mock.update.mockResolvedValueOnce({ error: { message: "denied" } });
  const { hook } = mount();
  await act(async () => {
    await expect(
      hook.result.current.mutateAsync({ name: "test" }),
    ).rejects.toThrow("denied");
  });
  expect(mock.audited).not.toHaveBeenCalled();
});

it("checks the session only before the write and around the cache refresh", async () => {
  mock.identity = { id: "u1", session: "s1" };
  mock.getSession.mockClear();
  mock.update.mockReset().mockResolvedValue({ error: null });
  const { hook } = mount();
  await act(async () => {
    await hook.result.current.mutateAsync({ name: "saved" });
  });
  expect(mock.getSession).toHaveBeenCalledTimes(3);
});
