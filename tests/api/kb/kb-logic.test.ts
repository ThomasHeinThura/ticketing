import { describe, expect, it } from "vitest";
import {
  deflectionQuery,
  nextState,
  reviewOverdue,
  searchTerms,
  snippet,
  TransitionError,
} from "../../../apps/api/src/kb/logic";
import { deflectionTerms } from "../../../apps/api/src/kb/repository";

describe("KB-4 article lifecycle", () => {
  it("publishes directly when there is no review step", () => {
    expect(nextState("draft", "publish", false)).toBe("published");
    expect(nextState("published", "publish", false)).toBe("published");
    expect(() => nextState("draft", "submit", false)).toThrow(TransitionError);
  });

  it("needs submit then publish when the review step is on", () => {
    expect(() => nextState("draft", "publish", true)).toThrow(TransitionError);
    expect(nextState("draft", "submit", true)).toBe("in_review");
    expect(nextState("in_review", "publish", true)).toBe("published");
    // A publisher republishes without taking the article off the portal.
    expect(nextState("published", "publish", true)).toBe("published");
  });

  it("archives and unpublishes", () => {
    expect(nextState("published", "unpublish", false)).toBe("draft");
    expect(nextState("in_review", "unpublish", true)).toBe("draft");
    expect(() => nextState("draft", "unpublish", false)).toThrow(
      TransitionError,
    );
    expect(nextState("published", "archive", false)).toBe("archived");
    expect(() => nextState("archived", "archive", false)).toThrow(
      TransitionError,
    );
    expect(() => nextState("archived", "publish", false)).toThrow(
      TransitionError,
    );
  });

  it("restores only an archived article, to draft", () => {
    expect(nextState("archived", "restore", false)).toBe("draft");
    expect(nextState("archived", "restore", true)).toBe("draft");
    for (const from of ["draft", "in_review", "published"] as const)
      expect(() => nextState(from, "restore", false)).toThrow(TransitionError);
  });
});

describe("search and deflection terms", () => {
  it("lower-cases, de-duplicates and caps search terms", () => {
    expect(searchTerms("VPN  vpn, Password!")).toEqual(["vpn", "password"]);
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
    expect(searchTerms("   ")).toEqual([]);
  });

  it("only suggests once the summary has substance, and ignores filler words", () => {
    expect(deflectionQuery("vp")).toBeNull();
    expect(deflectionQuery("  reset  ")).toBe("reset");
    expect(deflectionTerms("How can I reset my VPN password?")).toEqual([
      "reset",
      "vpn",
      "password",
    ]);
  });
});

describe("KB-7 review dates and snippets", () => {
  const now = new Date("2026-10-24T00:00:00Z");
  it("is overdue only with a past date", () => {
    expect(reviewOverdue(null, now)).toBe(false);
    expect(reviewOverdue(new Date("2026-10-23T00:00:00Z"), now)).toBe(true);
    expect(reviewOverdue(new Date("2026-10-25T00:00:00Z"), now)).toBe(false);
  });
  it("shortens long text", () => {
    expect(snippet("short")).toBe("short");
    expect(snippet("word ".repeat(100)).length).toBeLessThanOrEqual(160);
  });
});
