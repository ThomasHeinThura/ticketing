import { expect, it } from "vitest";
import { dayToIso, isoToDay } from "./work-item-date";

it("edits the selected calendar day while retaining the original UTC time", () => {
  expect(dayToIso(new Date(2026, 11, 4), "2026-10-22T15:30:00.000Z")).toBe(
    "2026-12-04T15:30:00.000Z",
  );
});
it("starts new dates at UTC midnight and explicitly clears them", () => {
  expect(dayToIso(new Date(2026, 11, 4), null)).toBe(
    "2026-12-04T00:00:00.000Z",
  );
  expect(dayToIso(undefined, "2026-10-22T15:30:00.000Z")).toBeNull();
});
it("maps an existing UTC date to the same calendar day rather than converting the clock zone", () => {
  const day = isoToDay("2026-10-22T23:59:00.000Z");
  expect([day?.getFullYear(), day?.getMonth(), day?.getDate()]).toEqual([
    2026, 9, 22,
  ]);
});
