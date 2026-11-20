import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  nextRetry,
} from "../../../apps/api/src/scheduler/attachment-gc-retry";

describe("attachment-gc nextRetry (PTM-06)", () => {
  it.each([
    [0, 1, 1],
    [1, 2, 2],
    [2, 3, 4],
    [3, 4, 8],
    [4, 5, 16],
    [5, 6, 30],
    [6, 7, 30],
    [100, 101, 30],
    [MAX_ATTEMPTS - 1, MAX_ATTEMPTS, 30],
    [MAX_ATTEMPTS, MAX_ATTEMPTS, 30],
    [-5, 1, 1],
  ])("%i attempts -> next %i, delay %i days", (old, next, days) => {
    expect(nextRetry(old)).toEqual({ next, days });
  });

  it("never exceeds the integer column or the 30 day cap", () => {
    for (const old of [0, 1, 6, 31, 1_000, 2 ** 31 - 2, 2 ** 31 - 1, 2 ** 40]) {
      const { next, days } = nextRetry(old);
      expect(next).toBeLessThanOrEqual(MAX_ATTEMPTS);
      expect(days).toBeLessThanOrEqual(30);
      expect(days).toBeGreaterThanOrEqual(1);
    }
  });
});
