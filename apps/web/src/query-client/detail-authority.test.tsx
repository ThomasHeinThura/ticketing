/**
 * A hover read of a work item started under one role must not satisfy a later open after the
 * caller's role changed. Driven through the app's real query client and the real role-change
 * mutation, which invalidates the caller's membership and capability queries.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useUpdateWorkspaceUserRole from "@/hooks/mutations/workspace-user/use-update-workspace-user-role";
import {
  prefetchWorkItemDetail,
  workItemDetailQueryKey,
} from "@/hooks/queries/work-item/use-get-work-item";
import { createQueryClient } from "./index";

const mocks = vi.hoisted(() => ({
  getWorkItem: vi.fn(),
  updateRole: vi.fn(),
}));
vi.mock("@/fetchers/work-item/get-work-item", () => ({
  default: (key: string) => mocks.getWorkItem(key),
}));
vi.mock("@/fetchers/workspace-user/update-workspace-member-role", () => ({
  default: (request: unknown) => mocks.updateRole(request),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("work item detail reads follow the caller's authority", () => {
  it("drops a read in flight when the caller's role changes, so opening the item asks again", async () => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(["workspace-user", "active", "w1"], {
      role: "admin",
    });
    queryClient.setQueryData(["workspace-capabilities", "w1", "admin"], {});
    let finish: (value: unknown) => void = () => {};
    mocks.getWorkItem.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    // Hover, as an admin: the read is on its way.
    prefetchWorkItemDetail(queryClient, "HELP-1");
    expect(mocks.getWorkItem).toHaveBeenCalledTimes(1);

    mocks.updateRole.mockResolvedValue({});
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useUpdateWorkspaceUserRole(), {
      wrapper,
    });
    result.current.mutate({
      workspaceId: "w1",
      userId: "me",
      role: "viewer",
      workspaceMemberId: null,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The admin-era answer arrives late.
    finish({ key: "HELP-1", title: "Private item" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      queryClient.getQueryData(workItemDetailQueryKey("HELP-1")),
    ).toBeUndefined();

    // Opening it now is a new read, not the five-second reuse of the old one.
    mocks.getWorkItem.mockRejectedValueOnce(new Error("forbidden"));
    prefetchWorkItemDetail(queryClient, "HELP-1");
    expect(mocks.getWorkItem).toHaveBeenCalledTimes(2);
  });
});
