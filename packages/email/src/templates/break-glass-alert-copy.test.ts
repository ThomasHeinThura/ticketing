import { describe, expect, it } from "vitest";
import { getBreakGlassAlertCopy } from "./break-glass-alert-copy";

describe("break-glass notification email copy", () => {
  it.each(["en", "de", "vi", "ja"] as const)(
    "returns fixed non-personalized copy for %s",
    (locale) => {
      const copy = getBreakGlassAlertCopy(locale);
      expect(copy.subject).toContain("TaskDesk");
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(0);
      expect(Object.values(copy).join(" ")).not.toMatch(
        /@|\buid\b|secret|token/i,
      );
    },
  );

  it("normalizes supported locale tags and falls back to English", () => {
    expect(getBreakGlassAlertCopy("ja-JP")).toEqual(
      getBreakGlassAlertCopy("ja"),
    );
    expect(getBreakGlassAlertCopy("fr")).toEqual(getBreakGlassAlertCopy("en"));
  });
});
