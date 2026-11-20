import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import {
  useDeleteNotificationWorkspaceRule,
  useUpdateNotificationPreferences,
  useUpsertNotificationWorkspaceRule,
} from "./use-notification-preferences";

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  refresh: vi.fn(),
  capture: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "u" }, session: { id: "s" } } }),
  },
}));
vi.mock("@/fetchers/settings/personal-history", () => ({
  captureNotificationHistoryRefresh: (...args: unknown[]) => {
    mocks.capture(...args);
    return mocks.refresh;
  },
}));
vi.mock(
  "@/fetchers/notification-preferences/update-notification-preferences",
  () => ({ default: (...args: unknown[]) => mocks.write(...args) }),
);
vi.mock(
  "@/fetchers/notification-preferences/upsert-notification-workspace-rule",
  () => ({ default: (...args: unknown[]) => mocks.write(...args) }),
);
vi.mock(
  "@/fetchers/notification-preferences/delete-notification-workspace-rule",
  () => ({ default: (...args: unknown[]) => mocks.write(...args) }),
);
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

it.each(["delivery", "upsert", "delete"] as const)(
  "refreshes captured history after successful %s and not failed writes",
  async (kind) => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => ({
        delivery: useUpdateNotificationPreferences(),
        upsert: useUpsertNotificationWorkspaceRule(),
        delete: useDeleteNotificationWorkspaceRule(),
      }),
      { wrapper },
    );
    mocks.capture.mockClear();
    mocks.refresh.mockReset();
    mocks.write
      .mockReset()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("failed"));
    const save = () =>
      kind === "delete"
        ? result.current.delete.mutateAsync("w")
        : kind === "upsert"
          ? result.current.upsert.mutateAsync({
              workspaceId: "w",
              json: {} as never,
            })
          : result.current.delivery.mutateAsync({} as never);
    await act(async () => {
      await save();
    });
    expect(mocks.capture).toHaveBeenCalledWith(client, "staff", {
      user: { id: "u" },
      session: { id: "s" },
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await act(async () => {
      await expect(save()).rejects.toThrow("failed");
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  },
);
