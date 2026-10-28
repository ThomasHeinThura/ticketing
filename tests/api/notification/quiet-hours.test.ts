import { describe, expect, it } from "vitest";
import {
  evaluateQuietHours,
  localMinutes,
  nextLocalOccurrence,
  parseClockMinutes,
  QUIET_HOURS_EXEMPT_EVENT_KINDS,
} from "../../../apps/api/src/notification/quiet-hours";

const at = (iso: string) => new Date(iso);

describe("NO-3 quiet hours", () => {
  it("parses strict HH:MM only", () => {
    expect(parseClockMinutes("00:00")).toBe(0);
    expect(parseClockMinutes("22:30")).toBe(1350);
    expect(parseClockMinutes("24:00")).toBeNull();
    expect(parseClockMinutes("7:00")).toBeNull();
    expect(parseClockMinutes("07:60")).toBeNull();
    expect(parseClockMinutes(null)).toBeNull();
  });

  it("reads local time in the person's zone", () => {
    expect(localMinutes(at("2026-01-15T12:00:00Z"), "Asia/Yangon")).toBe(
      18 * 60 + 30,
    );
    expect(localMinutes(at("2026-01-15T00:00:00Z"), "UTC")).toBe(0);
  });

  it("is not configured when start and end are both null, whatever the zone", () => {
    expect(
      evaluateQuietHours(
        { start: null, end: null, timezone: "Asia/Yangon" },
        "UTC",
        at("2026-01-15T12:00:00Z"),
      ),
    ).toEqual({ kind: "none" });
  });

  it("is unresolved when malformed, half-set, zero-length or in an unknown zone", () => {
    const now = at("2026-01-15T12:00:00Z");
    for (const setting of [
      { start: "22:00", end: null, timezone: "UTC" },
      { start: "22:00", end: "25:99", timezone: "UTC" },
      { start: "08:00", end: "08:00", timezone: "UTC" },
      { start: "22:00", end: "07:00", timezone: "Mars/Olympus" },
    ])
      expect(evaluateQuietHours(setting, "UTC", now)).toEqual({
        kind: "unresolved",
      });
  });

  it("handles a same-day window", () => {
    const setting = { start: "09:00", end: "17:00", timezone: "UTC" };
    expect(
      evaluateQuietHours(setting, "UTC", at("2026-01-15T08:59:00Z")),
    ).toEqual({ kind: "allowed" });
    expect(
      evaluateQuietHours(setting, "UTC", at("2026-01-15T09:00:00Z")),
    ).toMatchObject({ kind: "quiet", until: at("2026-01-15T17:00:00Z") });
    expect(
      evaluateQuietHours(setting, "UTC", at("2026-01-15T17:00:00Z")),
    ).toEqual({ kind: "allowed" });
  });

  it("handles a window crossing midnight and defers to the next end", () => {
    const setting = { start: "22:00", end: "07:00", timezone: "UTC" };
    expect(
      evaluateQuietHours(setting, "UTC", at("2026-01-15T23:30:00Z")),
    ).toMatchObject({ kind: "quiet", until: at("2026-01-16T07:00:00Z") });
    expect(
      evaluateQuietHours(setting, "UTC", at("2026-01-16T03:00:00Z")),
    ).toMatchObject({ kind: "quiet", until: at("2026-01-16T07:00:00Z") });
    expect(
      evaluateQuietHours(setting, "UTC", at("2026-01-16T07:00:00Z")),
    ).toEqual({ kind: "allowed" });
  });

  it("uses the instance zone when the person has none", () => {
    const setting = { start: "22:00", end: "07:00", timezone: null };
    // 16:30 UTC is 23:00 in Asia/Yangon (UTC+6:30).
    expect(
      evaluateQuietHours(setting, "Asia/Yangon", at("2026-01-15T16:30:00Z")),
    ).toMatchObject({ kind: "quiet", until: at("2026-01-16T00:30:00Z") });
    expect(
      evaluateQuietHours(setting, "UTC", at("2026-01-15T16:30:00Z")),
    ).toEqual({ kind: "allowed" });
  });

  it("lands on the real local end across a daylight-saving change", () => {
    // Europe/London springs forward at 01:00 UTC on 2026-03-29. 23:30 UTC on the 28th is
    // 23:30 GMT; the next local 07:00 is 06:00 UTC (BST), not 07:00 UTC.
    const until = nextLocalOccurrence(
      at("2026-03-28T23:30:00Z"),
      "Europe/London",
      7 * 60,
    );
    expect(until).toEqual(at("2026-03-29T06:00:00Z"));
    // Autumn: falls back at 01:00 UTC on 2026-10-25; 07:00 GMT is 07:00 UTC.
    expect(
      nextLocalOccurrence(at("2026-10-24T23:30:00Z"), "Europe/London", 7 * 60),
    ).toEqual(at("2026-10-25T07:00:00Z"));
  });

  it("exempts only SLA breach and approval expiry (not mentions)", () => {
    expect(QUIET_HOURS_EXEMPT_EVENT_KINDS.has("sla.breached")).toBe(true);
    expect(QUIET_HOURS_EXEMPT_EVENT_KINDS.has("approval.expiring")).toBe(true);
    expect(QUIET_HOURS_EXEMPT_EVENT_KINDS.has("approval.expired")).toBe(true);
    expect(QUIET_HOURS_EXEMPT_EVENT_KINDS.has("work_item.mentioned")).toBe(
      false,
    );
  });
});
