import { describe, expect, it } from "vitest";
import { formatPortalDuration } from "./portal-duration";

describe("formatPortalDuration (D4)", () => {
  it("uses minutes under an hour, hours under two days, then days", () => {
    expect(formatPortalDuration(20, "en-US")).toBe("1 min");
    expect(formatPortalDuration(45 * 60, "en-US")).toBe("45 min");
    expect(formatPortalDuration(5400, "en-US")).toBe("1.5 hr");
    expect(formatPortalDuration(47 * 3600, "en-US")).toBe("47 hr");
    expect(formatPortalDuration(3 * 86_400, "en-US")).toBe("3 days");
    expect(formatPortalDuration(-5, "en-US")).toBe("1 min");
  });
});
