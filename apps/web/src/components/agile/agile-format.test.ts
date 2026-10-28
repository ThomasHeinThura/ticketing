import { describe, expect, it } from "vitest";
import {
  formatMinutes,
  formatScopeAmount,
  hasForecastRange,
} from "./agile-format";

describe("agile formatting", () => {
  it("formats minutes as working weeks, days, hours and minutes", () => {
    expect(formatMinutes(0)).toBe("0m");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(480)).toBe("1d");
    expect(formatMinutes(2400 + 480 + 60)).toBe("1w 1d 1h");
  });

  it("formats an amount in the cycle's unit", () => {
    expect(formatScopeAmount(13, "points")).toBe("13");
    expect(formatScopeAmount(2.5, "points")).toBe("2.5");
    expect(formatScopeAmount(120, "time")).toBe("2h");
    expect(formatScopeAmount(4, "count")).toBe("4");
  });

  it("tells a ranged forecast from a statement", () => {
    expect(
      hasForecastRange({
        status: "on_track",
        earliest: "2026-11-01",
        latest: "2026-11-09",
        targetDate: "2026-11-15",
      }),
    ).toBe(true);
    expect(hasForecastRange({ status: "no_target" })).toBe(false);
  });
});
