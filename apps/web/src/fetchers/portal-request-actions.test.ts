import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@taskdesk/libs", () => ({
  apiFetch: (...args: unknown[]) => mocks.apiFetch(...args),
}));
vi.mock("@/fetchers/get-api-url", () => ({
  getApiUrl: (path: string) => `https://api.example.test/api/${path}`,
}));

import { actionErrorKey, PortalActionError } from "@/lib/portal-request";
import {
  escalatePortalSubmissionPriority,
  ratePortalSubmission,
  reopenPortalSubmission,
} from "./portal-request-actions";

type Init = { method?: string; body?: string; credentials?: string };
const lastCall = () => {
  const [url, init] = mocks.apiFetch.mock.calls.at(-1) as [string, Init];
  return { url, init };
};

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
});

describe("portal request actions", () => {
  it("posts the escalation to the fixed route with only the new priority", async () => {
    await escalatePortalSubmissionPriority({ ref: "REQ 1", priority: "high" });
    const { url, init } = lastCall();
    expect(url).toBe(
      "https://api.example.test/api/portal/submissions/REQ%201/escalate-priority",
    );
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body ?? "")).toEqual({ priority: "high" });
  });

  it("posts a reopen with no payload", async () => {
    await reopenPortalSubmission("REQ-1");
    const { url, init } = lastCall();
    expect(url).toBe(
      "https://api.example.test/api/portal/submissions/REQ-1/reopen",
    );
    expect(JSON.parse(init.body ?? "")).toEqual({});
  });

  it("posts a rating and omits an empty comment", async () => {
    await ratePortalSubmission({ ref: "REQ-1", rating: 4, comment: "" });
    expect(lastCall().url).toMatch(/\/REQ-1\/satisfaction$/);
    expect(JSON.parse(lastCall().init.body ?? "")).toEqual({ rating: 4 });
    await ratePortalSubmission({ ref: "REQ-1", rating: 2, comment: "Slow" });
    expect(JSON.parse(lastCall().init.body ?? "")).toEqual({
      rating: 2,
      comment: "Slow",
    });
  });

  it("turns a refusal into a coded error that never carries server text", async () => {
    mocks.apiFetch.mockResolvedValue(
      new Response("cannot_deescalate: internal detail about queue 7", {
        status: 403,
      }),
    );
    const error = await escalatePortalSubmissionPriority({
      ref: "REQ-1",
      priority: "low",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PortalActionError);
    expect((error as PortalActionError).code).toBe("cannot_deescalate");
    expect((error as PortalActionError).message).not.toContain("queue 7");
    expect(actionErrorKey(error)).toBe("cannot_deescalate");
  });
});
