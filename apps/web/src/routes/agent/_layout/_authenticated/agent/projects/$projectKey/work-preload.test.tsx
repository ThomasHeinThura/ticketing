import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workItemsPanelLoaded: vi.fn(),
  createDialogLoaded: vi.fn(),
}));

vi.mock("@/components/work-item/work-items-panel", () => {
  mocks.workItemsPanelLoaded();
  return { default: () => null };
});

vi.mock("@/components/work-item/work-item-create-dialog-shell", () => {
  mocks.createDialogLoaded();
  return { default: () => null };
});

import { Route } from "./work";

describe("work list route startup", () => {
  it("starts loading the list panel during route beforeLoad", async () => {
    mocks.workItemsPanelLoaded.mockClear();

    await Route.options.beforeLoad?.({} as never);
    await vi.waitFor(() =>
      expect(mocks.workItemsPanelLoaded).toHaveBeenCalledOnce(),
    );
  });

  it("keeps the create dialog out of route startup until it is requested", async () => {
    mocks.createDialogLoaded.mockClear();

    await Route.options.beforeLoad?.({} as never);

    expect(mocks.createDialogLoaded).not.toHaveBeenCalled();
  });
});
