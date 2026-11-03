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

describe("query retry policy (A-04, A-11)", () => {
  it("never retries a final refusal, but still retries server and transient errors", async () => {
    const { shouldRetryQuery } = await import("./index");
    const { HttpError } = await import("@/lib/http-error");
    for (const status of [400, 401, 403, 404, 409, 422])
      expect(shouldRetryQuery(0, new HttpError(status, "refused"))).toBe(false);
    for (const status of [408, 429, 500, 503])
      expect(shouldRetryQuery(0, new HttpError(status, "transient"))).toBe(
        true,
      );
    expect(shouldRetryQuery(2, new HttpError(500, "still down"))).toBe(false);
    expect(shouldRetryQuery(0, new Error("Failed to fetch"))).toBe(false);
    expect(shouldRetryQuery(0, new Error("unexpected"))).toBe(true);
  });
});
