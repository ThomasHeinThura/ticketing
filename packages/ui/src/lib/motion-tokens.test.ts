import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { motionTokens } from "./motion-tokens";

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
