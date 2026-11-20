import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import useCreateApiKey from "./api-key/use-create-api-key";
import useRequestApiKeyDeletion from "./api-key/use-request-api-key-deletion";
import useRevokeApiKey from "./api-key/use-revoke-api-key";
import useChangePassword from "./use-change-password";

const mocks = vi.hoisted(() => ({
  changePassword: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  request: vi.fn(),
  user: "u1",
  session: "s1",
  getSession: vi.fn(),
  audited: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: mocks.user }, session: { id: mocks.session } },
    }),
    getSession: mocks.getSession,
    changePassword: mocks.changePassword,
  },
}));
vi.mock("@/fetchers/api-keys", () => ({
  createMyApiKey: mocks.create,
  revokeMyApiKey: mocks.revoke,
  requestDeleteMyApiKey: mocks.request,
}));

afterEach(() => {
  vi.clearAllMocks();
  mocks.user = "u1";
  mocks.session = "s1";
});

function mount<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _context, mutation) =>
        mocks.audited(
          mutation.meta?.audits?.targets(variables as never, data as never),
        ),
    }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), client };
}

const password = {
  currentPassword: "old",
  newPassword: "new",
  revokeOtherSessions: true,
};

it("declares the security History target and audits only a successful password change", async () => {
  mocks.changePassword.mockResolvedValueOnce({
    data: { ok: true },
    error: null,
  });
  const { result } = mount(useChangePassword);
  await act(async () => {
    await result.current.mutateAsync(password);
  });
  expect(mocks.audited).toHaveBeenCalledWith([
    { kind: "self", audience: "staff", section: "security" },
  ]);
  mocks.audited.mockClear();
  mocks.changePassword.mockResolvedValueOnce({
    data: null,
    error: { code: "INVALID_PASSWORD" },
  });
  await act(async () => {
    await expect(result.current.mutateAsync(password)).rejects.toThrow(
      "INVALID_PASSWORD",
    );
  });
  expect(mocks.audited).not.toHaveBeenCalled();
});

it.each([
  ["create", useCreateApiKey],
  ["revoke", useRevokeApiKey],
] as const)(
  "declares the personal-key History target and audits %s success only",
  async (kind, hook) => {
    const producer = kind === "create" ? mocks.create : mocks.revoke;
    producer.mockResolvedValue({ id: "key1" });
    const { result } = mount(() => hook());
    await act(async () => {
      await result.current.mutateAsync(undefined as never);
    });
    expect(mocks.audited).toHaveBeenCalledWith([
      { kind: "self", audience: "staff", section: "apiKeys" },
    ]);
    mocks.audited.mockClear();
    producer.mockRejectedValueOnce(new Error("write failed"));
    await act(async () => {
      await expect(
        result.current.mutateAsync(undefined as never),
      ).rejects.toThrow("write failed");
    });
    expect(mocks.audited).not.toHaveBeenCalled();
  },
);

it("does not claim deletion history when only a pending action was requested", async () => {
  mocks.request.mockResolvedValue({ pendingActionId: "pending1" });
  const { result } = mount(useRequestApiKeyDeletion);
  await act(async () => {
    await result.current.mutateAsync("key1");
  });
  await waitFor(() => expect(mocks.request.mock.calls[0]?.[0]).toBe("key1"));
  expect(mocks.audited).toHaveBeenCalledWith(undefined);
});
