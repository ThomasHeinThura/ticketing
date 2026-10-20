// A UTC−x zone, where a UTC-midnight instant is still the previous local day. Set before
// any date formatter is created (formatters are built lazily and cached per module).
process.env.TZ = "America/Los_Angeles";

import { describe, expect, it, vi } from "vitest";
import { formatDateMedium } from "@/lib/format";
import { dayToIso, formatWorkItemDay, isoToDay } from "./work-item-properties";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

describe("work-item dates in a UTC−x zone", () => {
  const due = "2026-10-01T00:00:00.000Z";

  it("runs in a zone where the instant is the previous local day", () => {
    // Guards the premise: formatting the instant itself would show 30 September.
    expect(formatDateMedium(due, "en-US")).toBe("Sep 30, 2026");
  });

  it("labels the trigger with the same day the calendar selects", () => {
    const day = isoToDay(due) as Date;
    expect(day.getFullYear()).toBe(2026);
    expect(day.getMonth()).toBe(9);
    expect(day.getDate()).toBe(1);
    expect(formatWorkItemDay(due)).toBe(formatDateMedium(day));
    expect(formatDateMedium(day, "en-US")).toBe("Oct 1, 2026");
  });

  it("writes a picked day back as that UTC date, keeping the stored time of day", () => {
    expect(dayToIso(new Date(2026, 9, 3), "2026-10-01T17:00:00.000Z")).toBe(
      "2026-10-03T17:00:00.000Z",
    );
    expect(dayToIso(new Date(2026, 9, 3), null)).toBe(
      "2026-10-03T00:00:00.000Z",
    );
    expect(dayToIso(isoToDay(due), due)).toBe(due);
  });
});
