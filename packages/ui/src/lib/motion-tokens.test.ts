import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { mountCompiledMotionStyles } from "../test/compile-motion-css";
import {
  motionBezierOut,
  motionDurationMs,
  motionEasing,
  motionEasingFunction,
  motionTokens,
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

it("keeps the static animation values equal to theme.css", () => {
  const css = readFileSync(
    resolve(process.cwd(), "src/styles/theme.css"),
    "utf8",
  );
  for (const [key, value] of Object.entries(motionTokens)) {
    const prefix = ["fast", "base", "slow"].includes(key) ? "duration" : "ease";
    expect(
      css.match(new RegExp(`--${prefix}-${key}:\\s*([^;]+);`))?.[1]?.trim(),
    ).toBe(value);
  }
});
