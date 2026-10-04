import { describe, expect, it } from "vitest";
import { summarizeProfileCoverage } from "./performance-profile-intervals";

describe("aligned CPU profile coverage", () => {
  it("clips outside samples to the recorder boundaries and preserves edge gaps", () => {
    expect(
      summarizeProfileCoverage(
        [
          { start: 800, end: 1_010 },
          { start: 1_050, end: 1_200 },
          { start: 1_950, end: 2_100 },
          { start: 2_200, end: 2_300 },
        ],
        1_000,
        2_000,
      ),
    ).toEqual({
      observedStart: 1_000,
      observedEnd: 2_000,
      uncoveredPrefix: 0,
      uncoveredSuffix: 0,
      unionCoverage: 210,
    });
  });

  it("does not use samples just outside the interval to hide prefix or suffix gaps", () => {
    expect(
      summarizeProfileCoverage(
        [
          { start: 900, end: 990 },
          { start: 1_010, end: 1_100 },
          { start: 1_900, end: 1_990 },
          { start: 2_010, end: 2_100 },
        ],
        1_000,
        2_000,
      ),
    ).toEqual({
      observedStart: 1_010,
      observedEnd: 1_990,
      uncoveredPrefix: 10,
      uncoveredSuffix: 10,
      unionCoverage: 180,
    });
  });

  it("merges overlapping samples without double-counting and reports missing profiles", () => {
    expect(
      summarizeProfileCoverage(
        [
          { start: 1_000, end: 1_100 },
          { start: 1_050, end: 1_150 },
          { start: 1_300, end: 1_400 },
        ],
        1_000,
        2_000,
      ),
    ).toEqual({
      observedStart: 1_000,
      observedEnd: 1_400,
      uncoveredPrefix: 0,
      uncoveredSuffix: 600,
      unionCoverage: 250,
    });
    expect(summarizeProfileCoverage([], 1_000, 2_000)).toEqual({
      observedStart: null,
      observedEnd: null,
      uncoveredPrefix: 1_000,
      uncoveredSuffix: 1_000,
      unionCoverage: 0,
    });
  });
});
