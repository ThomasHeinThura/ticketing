import { describe, expect, it } from "vitest";
import { formatRelativeAge } from "./format-relative-age";

describe("IQ-5 submission age", () => {
  const now = new Date("2026-10-04T12:00:00.000Z");

  it("formats recent submitted-at values as localized relative ages", () => {
    expect(formatRelativeAge("2026-10-04T11:00:00.000Z", now, "en-US")).toBe(
      "1 hour ago",
    );
  });

  it("does not present a draft-style timestamp when the value is invalid", () => {
    expect(formatRelativeAge("invalid", now, "en-US")).toBe("");
  });
});
