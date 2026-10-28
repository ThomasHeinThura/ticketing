import { describe, expect, it } from "vitest";
import {
  actionErrorKey,
  describeDue,
  higherPriorities,
  messageAuthor,
  PortalActionError,
  parseErrorCode,
  readPortalSla,
  submissionStateKey,
} from "./portal-request";

describe("higherPriorities (CP-7)", () => {
  it("offers only strictly higher priorities", () => {
    expect(higherPriorities("medium")).toEqual(["high", "urgent"]);
    expect(higherPriorities("low")).toEqual(["medium", "high", "urgent"]);
    expect(higherPriorities(null)).toEqual(["low", "medium", "high", "urgent"]);
  });

  it("offers nothing at the top or for an unknown value", () => {
    expect(higherPriorities("urgent")).toEqual([]);
    expect(higherPriorities("sideways")).toEqual([]);
  });
});

describe("customer wording (CP-4, CP-5)", () => {
  it("maps known states and leaves unknown ones to the caller", () => {
    expect(submissionStateKey("clarifying")).toBe("request.state.clarifying");
    expect(submissionStateKey("submitted")).toBeNull();
  });

  it("names only staff the API names, and never invents a customer name", () => {
    expect(messageAuthor({ actorType: "customer", mine: true })).toEqual({
      key: "request.author.you",
    });
    expect(messageAuthor({ actorType: "customer", mine: false })).toEqual({
      key: "request.author.colleague",
    });
    expect(
      messageAuthor({ actorType: "triager", authorName: "Sam Lee" }),
    ).toEqual({ name: "Sam Lee" });
    expect(messageAuthor({ actorType: "triager", authorName: null })).toEqual({
      key: "request.author.team",
    });
  });
});

describe("readPortalSla (CP-6)", () => {
  it("accepts the documented shape only", () => {
    expect(
      readPortalSla({ state: "at_risk", dueAt: "2026-10-23T14:00:00Z" }),
    ).toEqual({ state: "at_risk", dueAt: "2026-10-23T14:00:00Z" });
    expect(readPortalSla({ state: "met" })).toEqual({
      state: "met",
      dueAt: null,
    });
    expect(readPortalSla({ state: "gold" })).toBeNull();
    expect(readPortalSla(undefined)).toBeNull();
  });
});

describe("describeDue (CP-6)", () => {
  const now = new Date(2026, 9, 23, 9, 0);
  it("says today, tomorrow or a date", () => {
    expect(
      describeDue(new Date(2026, 9, 23, 14, 0).toISOString(), now, "en-US"),
    ).toMatchObject({
      day: "today",
      time: "2:00 PM",
    });
    expect(
      describeDue(new Date(2026, 9, 24, 8, 0).toISOString(), now, "en-US").day,
    ).toBe("tomorrow");
    expect(
      describeDue(new Date(2026, 9, 30, 8, 0).toISOString(), now, "en-US").day,
    ).toBe("date");
  });
});

describe("portal action errors", () => {
  it("reads the leading code and ignores the rest", () => {
    expect(parseErrorCode("cannot_deescalate: cannot lower")).toBe(
      "cannot_deescalate",
    );
    expect(parseErrorCode("reopen_pending_review")).toBe(
      "reopen_pending_review",
    );
    expect(parseErrorCode("")).toBeNull();
    expect(parseErrorCode("<html>Bad gateway</html>")).toBeNull();
  });

  it("selects a message by code, then by status, never by server text", () => {
    expect(
      actionErrorKey(new PortalActionError(403, "cannot_deescalate: x")),
    ).toBe("cannot_deescalate");
    expect(actionErrorKey(new PortalActionError(404, "Not found"))).toBe(
      "notFound",
    );
    expect(actionErrorKey(new PortalActionError(409, "stale"))).toBe(
      "conflict",
    );
    expect(actionErrorKey(new PortalActionError(500, "boom_unknown"))).toBe(
      "generic",
    );
    expect(actionErrorKey(new Error("network"))).toBe("generic");
  });
});
