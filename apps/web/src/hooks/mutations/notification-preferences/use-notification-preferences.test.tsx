import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import {
  useDeleteNotificationWorkspaceRule,
  useUpdateNotificationPreferences,
  useUpsertNotificationWorkspaceRule,
} from "./use-notification-preferences";

const mocks = vi.hoisted(() => ({ write: vi.fn(), audited: vi.fn() }));
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
  "declares the notifications History target after successful %s and not failed writes",
  async (kind) => {
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
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
    const { result } = renderHook(
      () => ({
        delivery: useUpdateNotificationPreferences(),
        upsert: useUpsertNotificationWorkspaceRule(),
        delete: useDeleteNotificationWorkspaceRule(),
      }),
      { wrapper },
    );
    mocks.audited.mockReset();
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
    expect(mocks.audited).toHaveBeenCalledOnce();
    expect(mocks.audited).toHaveBeenCalledWith([
      { kind: "self", audience: "staff", section: "notifications" },
    ]);
    await act(async () => {
      await expect(save()).rejects.toThrow("failed");
    });
    expect(mocks.audited).toHaveBeenCalledOnce();
  },
);
