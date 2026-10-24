import { describe, expect, it } from "vitest";
import {
  digestWindowContaining,
  isKnownTimezone,
  nextDigestWindow,
} from "../../../apps/api/src/notification/digest-window";

const at = (iso: string) => new Date(iso);

describe("NO-5/NO-6 digest windows", () => {
  it("hourly windows span one local top-of-hour to the next", () => {
    const w = digestWindowContaining(
      at("2026-01-15T10:20:30Z"),
      "UTC",
      "hourly",
    );
    expect(w.startAt).toEqual(at("2026-01-15T10:00:00Z"));
    expect(w.endAt).toEqual(at("2026-01-15T11:00:00Z"));
  });

  it("hourly windows follow a half-hour offset zone's local hours", () => {
    // Asia/Yangon is UTC+6:30, so local 17:00 is 10:30 UTC.
    const w = digestWindowContaining(
      at("2026-01-15T10:45:00Z"),
      "Asia/Yangon",
      "hourly",
    );
    expect(w.startAt).toEqual(at("2026-01-15T10:30:00Z"));
    expect(w.endAt).toEqual(at("2026-01-15T11:30:00Z"));
  });

  it("daily windows span one local midnight to the next", () => {
    const w = digestWindowContaining(
      at("2026-01-15T20:00:00Z"),
      "Asia/Yangon",
      "daily",
    );
    // 20:00Z is 02:30 local on the 16th; the window is 16th 00:00 to 17th 00:00 local.
    expect(w.startAt).toEqual(at("2026-01-15T17:30:00Z"));
    expect(w.endAt).toEqual(at("2026-01-16T17:30:00Z"));
    expect(w.timezone).toBe("Asia/Yangon");
  });

  it("a daily window on a daylight-saving day is 23 hours, and on the autumn change 25", () => {
    const spring = digestWindowContaining(
      at("2026-03-29T12:00:00Z"),
      "Europe/London",
      "daily",
    );
    expect(spring.startAt).toEqual(at("2026-03-29T00:00:00Z"));
    expect(spring.endAt).toEqual(at("2026-03-29T23:00:00Z"));
    const autumn = digestWindowContaining(
      at("2026-10-25T12:00:00Z"),
      "Europe/London",
      "daily",
    );
    expect(autumn.startAt).toEqual(at("2026-10-24T23:00:00Z"));
    expect(autumn.endAt).toEqual(at("2026-10-26T00:00:00Z"));
  });

  it("windows tile: the next window starts exactly where the last ended", () => {
    const first = digestWindowContaining(
      at("2026-03-28T12:00:00Z"),
      "Europe/London",
      "daily",
    );
    const second = nextDigestWindow(first, "daily");
    expect(second.startAt).toEqual(first.endAt);
    const hour = digestWindowContaining(
      at("2026-01-15T10:20:00Z"),
      "UTC",
      "hourly",
    );
    expect(nextDigestWindow(hour, "hourly").startAt).toEqual(hour.endAt);
  });

  it("recognises known and unknown zones", () => {
    expect(isKnownTimezone("Europe/London")).toBe(true);
    expect(isKnownTimezone("Not/AZone")).toBe(false);
  });
});
