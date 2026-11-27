import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { warmWorkItemDetailOnIntent } from "./warm-work-item-detail-on-intent";

const mocks = vi.hoisted(() => ({ prefetch: vi.fn() }));
vi.mock("@/hooks/queries/work-item/use-get-work-item", () => ({
  prefetchWorkItemDetail: mocks.prefetch,
}));

function connection(value: object | undefined) {
  Object.defineProperty(navigator, "connection", {
    value,
    configurable: true,
  });
}

afterEach(() => {
  connection(undefined);
  vi.clearAllMocks();
});

describe("warmWorkItemDetailOnIntent", () => {
  it("reads the item on a normal connection", async () => {
    const client = new QueryClient();
    warmWorkItemDetailOnIntent(client, "HELP-1");
    await vi.waitFor(() =>
      expect(mocks.prefetch).toHaveBeenCalledWith(client, "HELP-1"),
    );
  });

  it.each([
    ["Save-Data", { saveData: true, effectiveType: "4g" }],
    ["2g", { saveData: false, effectiveType: "2g" }],
    ["slow-2g", { saveData: false, effectiveType: "slow-2g" }],
  ])("downloads and reads nothing on %s", async (_name, hints) => {
    connection(hints);
    warmWorkItemDetailOnIntent(new QueryClient(), "HELP-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.prefetch).not.toHaveBeenCalled();
  });
});
