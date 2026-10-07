import { expect } from "vitest";

/**
 * Keep values derived from credential manifests out of Vitest's rich diffs.
 * Callers must reduce rows, passwords, identities, cookies, and buffers to a boolean first.
 */
export function expectSafeSeedCondition(
  condition: boolean,
  expected = true,
): void {
  expect(condition).toBe(expected);
}
