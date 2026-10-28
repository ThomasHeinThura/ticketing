import { describe, expect, it } from "vitest";
import {
  easterSunday,
  generateHolidayPreset,
  HOLIDAY_PRESET_DATASET_VERSION,
  listHolidayPresets,
} from "./holiday-presets.js";

const dates = (country: string, year: number) =>
  Object.fromEntries(
    (generateHolidayPreset(country, year) ?? []).map((h) => [h.date, h.name]),
  );

describe("holiday presets (CAL-10, CAL-11)", () => {
  it("computes Easter for known years", () => {
    expect(easterSunday(2024)).toEqual({ y: 2024, m: 3, d: 31 });
    expect(easterSunday(2025)).toEqual({ y: 2025, m: 4, d: 20 });
    expect(easterSunday(2026)).toEqual({ y: 2026, m: 4, d: 5 });
  });
  it("generates the US federal list with observed days for 2026", () => {
    const us = dates("US", 2026);
    expect(us["2026-01-19"]).toBe("Martin Luther King Jr. Day");
    expect(us["2026-05-25"]).toBe("Memorial Day");
    // 4 July 2026 is a Saturday: observed Friday 3 July.
    expect(us["2026-07-03"]).toBe("Independence Day");
    expect(us["2026-11-26"]).toBe("Thanksgiving Day");
    expect(Object.keys(us)).toHaveLength(11);
  });
  it("generates England and Wales bank holidays for 2026", () => {
    const gb = dates("GB", 2026);
    expect(gb["2026-04-03"]).toBe("Good Friday");
    expect(gb["2026-04-06"]).toBe("Easter Monday");
    expect(gb["2026-05-04"]).toBe("Early May bank holiday");
    expect(gb["2026-05-25"]).toBe("Spring bank holiday");
    expect(gb["2026-08-31"]).toBe("Summer bank holiday");
    // 25 December 2026 is a Friday, 26 a Saturday: Boxing Day moves to Monday 28.
    expect(gb["2026-12-25"]).toBe("Christmas Day");
    expect(gb["2026-12-28"]).toBe("Boxing Day");
  });
  it("applies the Saturday and Sunday Christmas substitutes", () => {
    // 2027: 25 Dec Saturday, 26 Sunday.
    const gb = dates("GB", 2027);
    expect(gb["2027-12-27"]).toBe("Christmas Day");
    expect(gb["2027-12-28"]).toBe("Boxing Day");
    // 2022: 25 Dec Sunday, 26 Monday.
    const gb2022 = dates("GB", 2022);
    expect(gb2022["2022-12-26"]).toBe("Boxing Day");
    expect(gb2022["2022-12-27"]).toBe("Christmas Day");
  });
  it("uses Easter-relative days for Germany", () => {
    const de = dates("DE", 2026);
    expect(de["2026-05-14"]).toBe("Christi Himmelfahrt");
    expect(de["2026-05-25"]).toBe("Pfingstmontag");
  });
  it("returns dates sorted and unique", () => {
    for (const { country } of listHolidayPresets()) {
      const list = generateHolidayPreset(country, 2026) ?? [];
      const sorted = [...list].map((h) => h.date).sort();
      expect(list.map((h) => h.date)).toEqual(sorted);
      expect(new Set(sorted).size).toBe(sorted.length);
    }
  });
  it("states what each preset leaves out and a dataset version", () => {
    expect(HOLIDAY_PRESET_DATASET_VERSION).toMatch(/^\d{4}\.\d{2}\.\d+$/);
    for (const preset of listHolidayPresets())
      expect(preset.notIncluded.length).toBeGreaterThan(10);
  });
  it("rejects an unknown country or absurd year", () => {
    expect(generateHolidayPreset("ZZ", 2026)).toBeNull();
    expect(generateHolidayPreset("US", 1500)).toBeNull();
  });
});
