import { describe, expect, it } from "vitest";
import { HolidayImportError, parseHolidayIcs } from "./holiday-import.js";

function file(events: string) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TaskDesk//Holiday Import//EN",
    events,
    "END:VCALENDAR",
  ].join("\r\n");
}

function event(start: string, rest = "") {
  return [
    "BEGIN:VEVENT",
    "UID:test-event-1",
    "DTSTAMP:20261003T120000Z",
    `DTSTART;VALUE=DATE:${start}`,
    rest,
    "END:VEVENT",
  ]
    .filter(Boolean)
    .join("\r\n");
}

describe("CAL-17 bounded holiday import", () => {
  it("parses finite DATE events, exclusive DTEND, unfolding and escaped SUMMARY", () => {
    const parsed = parseHolidayIcs(
      file(
        event(
          "20261224",
          [
            "DTEND;VALUE=DATE:20261227",
            "SUMMARY:End of year\\, company\\nclosure",
          ].join("\r\n"),
        ),
      ),
    );
    expect(parsed).toEqual([
      {
        from: "2026-12-24",
        to: "2026-12-26",
        name: "End of year, company\nclosure",
      },
    ]);
    expect(
      parseHolidayIcs(file(event("20260101", "SUMMARY:New\r\n Year")))[0],
    ).toMatchObject({ name: "NewYear" });
  });

  it("defaults missing DTEND to the following date and normalizes names", () => {
    expect(
      parseHolidayIcs(file(event("20260228", "SUMMARY:  Cafe\u0301  "))),
    ).toEqual([{ date: "2026-02-28", name: "Café" }]);
    expect(parseHolidayIcs(file(event("99981231")))).toEqual([
      { date: "9998-12-31" },
    ]);
  });

  it.each([
    ["empty event set", file("")],
    [
      "timed start",
      file(
        event("20260101").replace(
          "DTSTART;VALUE=DATE:20260101",
          "DTSTART:20260101T000000Z",
        ),
      ),
    ],
    ["recurrence", file(event("20260101", "RRULE:FREQ=YEARLY"))],
    ["invalid real date", file(event("20260230"))],
    [
      "invalid DTSTAMP",
      file(event("20260101").replace("20261003T120000Z", "20261303T120000Z")),
    ],
    [
      "unsupported property",
      file(event("20260101", "ATTACH:https://example.invalid/a")),
    ],
    ["bad escape", file(event("20260101", "SUMMARY:Bad\\q"))],
    [
      "unescaped summary punctuation",
      file(event("20260101", "SUMMARY:New, Year")),
    ],
    [
      "non-RFC line endings",
      file(event("20260101", "SUMMARY:LF")).replaceAll("\r\n", "\n"),
    ],
    ["unterminated event", file(event("20260101").replace("END:VEVENT", ""))],
  ])("rejects %s with a typed actionable error", (_label, value) => {
    expect(() => parseHolidayIcs(value)).toThrow(HolidayImportError);
  });

  it("rejects events longer than 366 inclusive dates", () => {
    expect(() =>
      parseHolidayIcs(file(event("20260101", "DTEND;VALUE=DATE:20270103"))),
    ).toThrow(/366 covered dates/);
  });

  it("enforces decoded input, unfolded line and event count limits", () => {
    expect(() => parseHolidayIcs(" ".repeat(256 * 1024 + 1))).toThrow(
      /256 KiB/,
    );
    expect(() =>
      parseHolidayIcs(file(event("20260101", `SUMMARY:${"x".repeat(8192)}`))),
    ).toThrow(/8 KiB/);
    const many = Array.from({ length: 1001 }, (_, i) =>
      event("20260101").replace("test-event-1", `event-${i}`),
    ).join("\r\n");
    expect(() => parseHolidayIcs(file(many))).toThrow(/1,000 event/);
  });
});
