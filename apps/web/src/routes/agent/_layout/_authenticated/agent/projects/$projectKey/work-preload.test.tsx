import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workItemsPanelLoaded: vi.fn(),
  workItemListLoaded: vi.fn(),
}));

vi.mock("@/components/work-item/work-item-list", () => {
  mocks.workItemListLoaded();
  return { default: () => null };
});

vi.mock("@/components/work-item/work-items-panel", () => {
  mocks.workItemsPanelLoaded();
  return { default: () => null };
});

import { Route } from "./work";

describe("work list route preload", () => {
  it("starts loading the list panel during route beforeLoad", async () => {
    mocks.workItemsPanelLoaded.mockClear();
    mocks.workItemListLoaded.mockClear();

    await Route.options.beforeLoad?.({} as never);
    await vi.waitFor(() =>
      expect(mocks.workItemsPanelLoaded).toHaveBeenCalledOnce(),
    );
    // The list is its own chunk; starting it with the panel keeps the rows from suspending
    // behind the panel skeleton (G11 work-list render).
    await vi.waitFor(() => expect(mocks.workItemListLoaded).toHaveBeenCalled());
  });
});
