import { expect, it } from "vitest";
import { mountCompiledMotionStyles } from "../test/compile-motion-css";
import {
  motionBezierOut,
  motionDurationMs,
  motionEasing,
  motionEasingFunction,
} from "./motion-tokens";

it("reads the compiled duration and easing variables", async () => {
  const compiled = await mountCompiledMotionStyles([
    "duration-base",
    "duration-slow",
    "ease-out",
  ]);
  try {
    expect(motionDurationMs("base")).toBe(200);
    expect(motionDurationMs("slow")).toBe(300);
    expect(motionBezierOut()).toEqual([0.23, 1, 0.32, 1]);
    expect(motionEasing("spring")).toContain("linear(");
    expect(motionEasingFunction("spring")(0.5)).toBeGreaterThan(0.9);
  } finally {
    compiled.cleanup();
  }
});
