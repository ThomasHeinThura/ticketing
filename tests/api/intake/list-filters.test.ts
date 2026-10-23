import { describe, expect, it } from "vitest";
import {
  filtersScope,
  olderThanCutoff,
  parseSubmissionListFilters,
} from "../../../apps/api/src/intake/list-filters";

describe("submission list filters (IQ-21)", () => {
  it("parses nothing to nothing and ignores blanks", () => {
    expect(parseSubmissionListFilters({})).toEqual({});
    expect(
      parseSubmissionListFilters({ requestTypeKey: " ", assignee: "" }),
    ).toEqual({});
  });

  it("parses each filter", () => {
    expect(
      parseSubmissionListFilters({
        requestTypeKey: "access-request",
        assignee: "unclaimed",
        olderThanDays: "7",
      }),
    ).toEqual({
      requestTypeKey: "access-request",
      assignee: "unclaimed",
      olderThanDays: 7,
    });
  });

  it.each(["-1", "1.5", "abc", "99999", "7d"])(
    "rejects olderThanDays=%s",
    (value) => {
      expect(() =>
        parseSubmissionListFilters({ olderThanDays: value }),
      ).toThrow();
    },
  );

  it("computes the cutoff and a filter-specific cursor scope", () => {
    const now = new Date("2026-10-23T00:00:00Z");
    expect(olderThanCutoff(2, now)).toEqual(new Date("2026-10-21T00:00:00Z"));
    expect(filtersScope({})).not.toBe(filtersScope({ assignee: "unclaimed" }));
    expect(filtersScope({ olderThanDays: 1 })).not.toBe(
      filtersScope({ olderThanDays: 2 }),
    );
  });
});
