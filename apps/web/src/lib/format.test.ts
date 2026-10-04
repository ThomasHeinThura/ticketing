import { describe, expect, it } from "vitest";
import { formatDateShort } from "./format";

describe("formatDateShort", () => {
  it("formats the same date with the requested locale", () => {
    const date = new Date(2026, 9, 4, 12);

    expect(formatDateShort(date, "en-US")).toBe("Oct 4");
    expect(formatDateShort(date, "en-GB")).toBe("4 Oct");
  });
});
