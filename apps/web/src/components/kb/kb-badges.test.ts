import { describe, expect, it } from "vitest";
import { formatKbDueDate } from "./kb-badges";

describe("formatKbDueDate", () => {
  it("shows the stored calendar day whatever the viewer's time zone", () => {
    const expected = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2028, 1, 29)));
    expect(formatKbDueDate("2028-02-29T00:00:00.000Z")).toBe(expected);
    // Formatting the same instant in a zone west of UTC would show 28 Feb.
    expect(
      new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "America/Los_Angeles",
      }).format(new Date("2028-02-29T00:00:00.000Z")),
    ).toBe("Feb 28, 2028");
  });

  it("returns an empty string when there is no due date", () => {
    expect(formatKbDueDate(null)).toBe("");
  });
});
