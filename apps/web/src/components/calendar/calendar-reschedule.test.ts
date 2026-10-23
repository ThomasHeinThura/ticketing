import { addDays } from "date-fns";
import { describe, expect, it } from "vitest";
import { dayToIso, isoToDay } from "@/lib/work-item-date";
import {
  rescheduledFields,
  resolveCalendarMove,
  shiftStoredDate,
} from "./calendar-reschedule";

const weekRects = [0, 1, 2, 3].map((index) => ({
  top: index * 100,
  height: 100,
}));
const activeRect = { top: 120, height: 20 };

describe("resolveCalendarMove (VW-26)", () => {
  const base = { activeRect, weekRects, cellWidth: 100, startColumn: 2 };

  it("moves by whole day columns, rounding to the nearest cell", () => {
    expect(
      resolveCalendarMove({ ...base, deltaX: 140, deltaY: 0 }).dayShift,
    ).toBe(1);
    expect(
      resolveCalendarMove({ ...base, deltaX: -240, deltaY: 0 }).dayShift,
    ).toBe(-2);
    expect(
      resolveCalendarMove({ ...base, deltaX: 30, deltaY: 0 }).dayShift,
    ).toBe(0);
  });

  it("moves a week for each row crossed", () => {
    expect(
      resolveCalendarMove({ ...base, deltaX: 0, deltaY: 100 }).dayShift,
    ).toBe(7);
    expect(
      resolveCalendarMove({ ...base, deltaX: 0, deltaY: -100 }).dayShift,
    ).toBe(-7);
  });

  it("combines a row and a column move", () => {
    const move = resolveCalendarMove({ ...base, deltaX: 100, deltaY: 100 });
    expect(move).toMatchObject({
      sourceWeek: 1,
      targetWeek: 2,
      targetColumn: 3,
      dayShift: 8,
    });
  });

  it("keeps the bar inside the grid horizontally and vertically", () => {
    expect(
      resolveCalendarMove({ ...base, deltaX: 5000, deltaY: 0 }).targetColumn,
    ).toBe(6);
    expect(
      resolveCalendarMove({ ...base, deltaX: -5000, deltaY: 0 }).targetColumn,
    ).toBe(0);
    expect(
      resolveCalendarMove({ ...base, deltaX: 0, deltaY: 9000 }).targetWeek,
    ).toBe(3);
  });

  it("does nothing when the grid has not been measured", () => {
    expect(
      resolveCalendarMove({
        ...base,
        weekRects: [],
        deltaX: 300,
        deltaY: 300,
      }).dayShift,
    ).toBe(0);
  });
});

describe("shiftStoredDate and rescheduledFields", () => {
  it("shifts the day, keeps the stored UTC time and matches the detail pane's write", () => {
    expect(shiftStoredDate("2026-10-14T09:30:00.000Z", 3)).toBe(
      "2026-10-17T09:30:00.000Z",
    );
    expect(shiftStoredDate("2026-10-14T09:30:00.000Z", 3)).toBe(
      dayToIso(
        addDays(isoToDay("2026-10-14T09:30:00.000Z") as Date, 3),
        "2026-10-14T09:30:00.000Z",
      ),
    );
  });

  it("is not moved by a daylight-saving change in the span", () => {
    // 29 Mar 2026 is the European spring-forward day.
    expect(shiftStoredDate("2026-03-28T23:30:00.000Z", 3)).toBe(
      "2026-03-31T23:30:00.000Z",
    );
    expect(shiftStoredDate("2026-03-31T00:00:00.000Z", -3)).toBe(
      "2026-03-28T00:00:00.000Z",
    );
  });

  it("keeps a plain date plain", () => {
    expect(shiftStoredDate("2026-10-30", 3)).toBe("2026-11-02");
    expect(shiftStoredDate("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("moves only the dates the item has and keeps a spanning item's length", () => {
    expect(
      rescheduledFields({ startDate: null, dueDate: "2026-10-14" }, 2),
    ).toEqual({ dueDate: "2026-10-16" });
    expect(
      rescheduledFields({ startDate: "2026-10-10", dueDate: null }, -1),
    ).toEqual({ startDate: "2026-10-09" });
    expect(
      rescheduledFields({ startDate: "2026-10-10", dueDate: "2026-10-14" }, 7),
    ).toEqual({ startDate: "2026-10-17", dueDate: "2026-10-21" });
  });
});
