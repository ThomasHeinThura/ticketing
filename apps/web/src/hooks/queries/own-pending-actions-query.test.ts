import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const { getOwnPendingActions } = vi.hoisted(() => ({
  getOwnPendingActions: vi.fn(),
}));
vi.mock("@/fetchers/pending-actions", () => ({ getOwnPendingActions }));

import { ownPendingActionsQuery } from "./own-pending-actions-query";

const page = (ids: string[]) => ({
  data: ids.map((id) => ({ id })),
  page: { nextCursor: null, hasMore: false },
  meta: { total: ids.length },
});

describe("ownPendingActionsQuery", () => {
  it("refetches on re-open after an unmounted list was invalidated, under the app default refetchOnMount:false", async () => {
    // Same defaults as src/query-client/index.ts.
    const client = new QueryClient({
      defaultOptions: { queries: { refetchOnMount: false, retry: false } },
    });
    getOwnPendingActions
      .mockResolvedValueOnce(page(["approved-action"]))
      .mockResolvedValueOnce(page([]));

    // First visit shows the pending action, then the list unmounts.
    const first = new QueryObserver(client, ownPendingActionsQuery());
    const unsubscribeFirst = first.subscribe(() => {});
    await vi.waitFor(() =>
      expect(first.getCurrentResult().data?.data).toHaveLength(1),
    );
    unsubscribeFirst();

    // Approval on the detail page: the inactive list is only invalidated.
    await client.invalidateQueries({ queryKey: ["me", "pending-actions"] });
    expect(getOwnPendingActions).toHaveBeenCalledTimes(1);

    // Back-navigation mounts the list again and must show current server data.
    const second = new QueryObserver(client, ownPendingActionsQuery());
    const unsubscribeSecond = second.subscribe(() => {});
    await vi.waitFor(() =>
      expect(second.getCurrentResult().data?.data).toHaveLength(0),
    );
    expect(getOwnPendingActions).toHaveBeenCalledTimes(2);
    unsubscribeSecond();
  });
});
