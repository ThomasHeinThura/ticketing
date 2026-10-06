import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workItemsPanelLoaded: vi.fn(),
  createDialogShellLoaded: vi.fn(),
}));

vi.mock("@/components/work-item/work-items-panel", () => {
  mocks.workItemsPanelLoaded();
  return { default: () => null };
});

vi.mock("@/components/work-item/work-item-create-dialog-shell", () => {
  mocks.createDialogShellLoaded();
  return { default: () => null };
});

import { Route } from "./work";

describe("work list route startup", () => {
  it("starts loading the list panel during route beforeLoad", async () => {
    mocks.workItemsPanelLoaded.mockClear();
    mocks.createDialogShellLoaded.mockClear();

    await Route.options.beforeLoad?.({} as never);
    await vi.waitFor(() =>
      expect(mocks.workItemsPanelLoaded).toHaveBeenCalledOnce(),
    );
    expect(mocks.createDialogShellLoaded).not.toHaveBeenCalled();
  });
});
