import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@/lib/format", () => ({
  formatDateMedium: (value: string) => value,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { parseChangeKeys } from "./releases-list";
import { fromDateTimeLocal, toDateTimeLocal } from "./shared";

describe("date-time inputs", () => {
  it("round-trips an instant through a datetime-local value", () => {
    const iso = "2031-03-04T09:30:00.000Z";
    const local = toDateTimeLocal(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
    expect(fromDateTimeLocal(local)).toBe(iso);
  });

  it("treats empty and invalid values as no value", () => {
    expect(toDateTimeLocal(null)).toBe("");
    expect(toDateTimeLocal("nonsense")).toBe("");
    expect(fromDateTimeLocal("")).toBeNull();
    expect(fromDateTimeLocal("not a date")).toBeNull();
  });
});

describe("release change keys", () => {
  it("splits on commas, spaces and new lines and drops duplicates", () => {
    expect(parseChangeKeys("OPS-1, OPS-2\nOPS-1  OPS-3,")).toEqual([
      "OPS-1",
      "OPS-2",
      "OPS-3",
    ]);
    expect(parseChangeKeys("")).toEqual([]);
  });
});
