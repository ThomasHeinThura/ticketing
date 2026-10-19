import { notifyManager } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import "./index";

describe("query client notification scheduling", () => {
  it("delivers observer notifications in a microtask, before any timer", async () => {
    const order: string[] = [];
    setTimeout(() => order.push("timer"), 0);
    notifyManager.schedule(() => order.push("notify"));
    await Promise.resolve();
    expect(order).toEqual(["notify"]);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(order).toEqual(["notify", "timer"]);
  });
});
