import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  workItemsPanelLoaded: vi.fn(),
}));

vi.mock("@/components/work-item/work-items-panel", () => {
  mocks.workItemsPanelLoaded();
  return { default: () => null };
});

import { Route } from "./work";

describe("work list route preload", () => {
  it("starts loading the list panel during route beforeLoad", async () => {
    mocks.workItemsPanelLoaded.mockClear();

    await Route.options.beforeLoad?.({
      context: { queryClient: new QueryClient(), session: null },
      params: { projectKey: "WLP" },
      search: { layout: "list", sort: "key", dir: "asc" },
      cause: "preload",
    } as never);
    await vi.waitFor(() =>
      expect(mocks.workItemsPanelLoaded).toHaveBeenCalledOnce(),
    );
  });
});
