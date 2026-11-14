import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  motionBezierOut,
  motionDurationMs,
  motionEasing,
  motionEasingFunction,
} from "./motion-tokens";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("does not read computed style when animation tokens are consumed during render", () => {
  const read = vi.spyOn(window, "getComputedStyle");
  function Consumer() {
    const values = [
      motionDurationMs("fast"),
      motionDurationMs("base"),
      motionDurationMs("slow"),
      motionEasing("spring"),
      motionEasingFunction("spring")(0.5),
      motionBezierOut().toString(),
    ];
    return <span>{values.join(",")}</span>;
  }
  render(<Consumer />);
  expect(read).not.toHaveBeenCalled();
});
