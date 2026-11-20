import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { personalSelfHistoryKey } from "@/fetchers/settings/personal-history";
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
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), client, invalidate };
}

const password = {
  currentPassword: "old",
  newPassword: "new",
  revokeOtherSessions: true,
};

it("refreshes captured security history only after successful password change without waiting for history", async () => {
  mocks.changePassword.mockResolvedValue({ data: { ok: true }, error: null });
  mocks.getSession.mockImplementation(() => new Promise(() => {}));
  const { result, invalidate, client } = mount(useChangePassword);
  await act(async () => {
    await result.current.mutateAsync(password);
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: personalSelfHistoryKey("security", "staff", "u1", "s1"),
    exact: true,
    refetchType: "active",
  });
  expect(
    client.getQueryData(
      personalSelfHistoryKey("security", "staff", "u1", "s1"),
    ),
  ).toBeNull();
});

it("does not refresh security history on failed password change", async () => {
  mocks.changePassword.mockResolvedValue({
    data: null,
    error: { code: "INVALID_PASSWORD" },
  });
  const { result, invalidate } = mount(useChangePassword);
  await act(async () => {
    await expect(result.current.mutateAsync(password)).rejects.toThrow(
      "INVALID_PASSWORD",
    );
  });
  expect(invalidate).not.toHaveBeenCalled();
});

it.each([
  ["create", useCreateApiKey],
  ["revoke", useRevokeApiKey],
] as const)(
  "refreshes captured personal-key history after %s success only",
  async (kind, hook) => {
    mocks.getSession.mockResolvedValue({
      data: { user: { id: "u1" }, session: { id: "s1" } },
      error: null,
    });
    const producer = kind === "create" ? mocks.create : mocks.revoke;
    producer.mockResolvedValue({ id: "key1" });
    const { result, invalidate } = mount(() => hook());
    await act(async () => {
      await result.current.mutateAsync(undefined as never);
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: personalSelfHistoryKey("apiKeys", "staff", "u1", "s1"),
      exact: true,
      refetchType: "active",
    });
    invalidate.mockClear();
    producer.mockRejectedValueOnce(new Error("write failed"));
    await act(async () => {
      await expect(
        result.current.mutateAsync(undefined as never),
      ).rejects.toThrow("write failed");
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: personalSelfHistoryKey("apiKeys", "staff", "u1", "s1"),
      exact: true,
      refetchType: "active",
    });
  },
);

it("does not claim deletion history when only a pending action was requested", async () => {
  mocks.request.mockResolvedValue({ pendingActionId: "pending1" });
  const { result, invalidate } = mount(useRequestApiKeyDeletion);
  await act(async () => {
    await result.current.mutateAsync("key1");
  });
  await waitFor(() => expect(mocks.request.mock.calls[0]?.[0]).toBe("key1"));
  expect(invalidate).not.toHaveBeenCalled();
});
