import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { useInstanceUserActions } from "@/hooks/queries/god-mode/use-instance-users";
import useResetPassword from "./use-reset-password";
import useTransferWorkspaceOwnership from "./workspace/use-transfer-workspace-ownership";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/portal-auth-client", () => ({
  portalAuthClient: { $fetch: mocks.request },
}));
vi.mock("@/fetchers/workspace/transfer-workspace-ownership", () => ({
  default: mocks.request,
}));
vi.mock("@/fetchers/god-mode/instance-users", () => ({
  getInstanceUser: vi.fn(),
  getInstanceUsers: vi.fn(),
  grantInstanceAdmin: mocks.request,
  requestInstanceUserDeactivation: vi.fn(),
  resetInstanceUserMfa: mocks.request,
  signOutInstanceUser: vi.fn(),
  startInstanceUserImpersonation: mocks.request,
  suspendInstanceUser: mocks.request,
  unsuspendInstanceUser: vi.fn(),
}));

function mount<T>(hook: () => T) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(hook, { wrapper }), client };
}

it("does not cache a rejected password reset", async () => {
  mocks.request.mockRejectedValueOnce(new Error("failed"));
  const { result, client } = mount(useResetPassword);
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        token: "synthetic-proof",
        newPassword: "synthetic-password",
      }),
    ).rejects.toThrow();
  });
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.variables),
    ),
  ).not.toMatch(/synthetic-proof|synthetic-password/);
});

it("does not cache a rejected ownership transfer proof", async () => {
  mocks.request.mockRejectedValueOnce(new Error("failed"));
  const { result, client } = mount(useTransferWorkspaceOwnership);
  await act(async () => {
    await expect(
      result.current.mutateAsync({
        workspaceId: "w",
        newOwnerUserId: "u",
        stepUpToken: "synthetic-proof",
      }),
    ).rejects.toThrow();
  });
  expect(
    JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.variables),
    ),
  ).not.toContain("synthetic-proof");
});

it.each(["suspend", "grantAdmin", "resetMfa", "impersonate"] as const)(
  "does not cache a rejected %s proof",
  async (action) => {
    mocks.request.mockRejectedValueOnce(new Error("failed"));
    const { result, client } = mount(useInstanceUserActions);
    const input = {
      id: "u",
      token: "synthetic-proof",
      request: { reason: "reason" },
      verificationNote: "note",
      reason: "reason",
    };
    await act(async () => {
      await expect(result.current[action].mutateAsync(input)).rejects.toThrow();
    });
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state.variables),
      ),
    ).not.toContain("synthetic-proof");
  },
);
