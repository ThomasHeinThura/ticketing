import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type RecentItem, resolveRecentItems } from "./recent-items";
import { useRecentItems } from "./use-recent-items";

vi.mock("./recent-items", () => ({ resolveRecentItems: vi.fn() }));

describe("reachable recent items", () => {
  it("does not show a previous workspace or an obsolete response", async () => {
    let resolveOld: (value: RecentItem[]) => void = () => {};
    vi.mocked(resolveRecentItems).mockImplementation((_user, workspace) =>
      workspace === "old"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve([]),
    );
    const { result, rerender } = renderHook(
      ({ workspace }) => useRecentItems(true, "u", workspace),
      { initialProps: { workspace: "old" } },
    );
    rerender({ workspace: "new" });
    await waitFor(() => expect(resolveRecentItems).toHaveBeenCalledTimes(2));
    await act(async () =>
      resolveOld([
        { type: "project", id: "hidden", title: "Hidden", href: "/hidden" },
      ]),
    );
    expect(result.current).toEqual([]);
  });
});
