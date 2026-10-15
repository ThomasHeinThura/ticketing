import { notifyManager } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

// Deliberately does not import the query client: this asserts the unit-test
// setup itself installs the production notification scheduler.
describe("unit-test harness", () => {
  it("delivers observer notifications before a queued setTimeout(0) callback", async () => {
    const order: string[] = [];
    setTimeout(() => order.push("timer"), 0);
    notifyManager.schedule(() => order.push("notify"));
    await Promise.resolve();
    expect(order).toEqual(["notify"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
});
