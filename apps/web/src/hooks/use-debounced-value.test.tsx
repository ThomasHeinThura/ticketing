import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useDebouncedValue } from "./use-debounced-value";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("settles on the latest value once, after the typing pause", () => {
  const seen: string[] = [];
  const { result, rerender } = renderHook(
    ({ value }) => {
      const debounced = useDebouncedValue(value, 250);
      if (seen.at(-1) !== debounced) seen.push(debounced);
      return debounced;
    },
    { initialProps: { value: "" } },
  );
  for (const value of ["a", "ab", "abc", "abcd", "abcde"]) {
    rerender({ value });
    act(() => {
      vi.advanceTimersByTime(50);
    });
  }
  expect(result.current).toBe("");
  act(() => {
    vi.advanceTimersByTime(250);
  });
  expect(result.current).toBe("abcde");
  expect(seen).toEqual(["", "abcde"]);
});
