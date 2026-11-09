import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tokens = readFileSync(resolve(here, "tokens.css"), "utf8");
const theme = readFileSync(resolve(here, "theme.css"), "utf8");

function fontFace(family: string): string {
  const faces = tokens.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const face = faces.find((block) => block.includes(`"${family}"`));
  if (!face) throw new Error(`no @font-face for ${family}`);
  return face;
}

describe("Geist's size-matched fallback face", () => {
  // Geist Variable's metrics in Chromium (units per em 1000): ascent 1005, descent 295, no line
  // gap, and Latin text about 1.9 % wider than Arial. Arial and Liberation Sans share metrics.
  it("draws Arial, or its metric twin on Linux, at Geist's width and line metrics", () => {
    const face = fontFace("Geist Fallback");
    expect(face).toMatch(
      /src:\s*local\("Arial"\),\s*local\("ArialMT"\),\s*local\("Liberation Sans"\),\s*local\("LiberationSans"\);/,
    );
    const percent = (name: string) =>
      Number(new RegExp(`${name}:\\s*([\\d.]+)%`).exec(face)?.[1]);
    const sizeAdjust = percent("size-adjust");
    // At least as wide as Geist, so the work-list preview painted in it is never smaller than
    // the same rows in Geist (a larger repaint would be a later LCP entry), and barely wider.
    expect(sizeAdjust).toBeGreaterThanOrEqual(102);
    expect(sizeAdjust).toBeLessThanOrEqual(103);
    // Overrides are scaled by size-adjust: the used ascent and descent equal Geist's.
    expect(Math.round((percent("ascent-override") * sizeAdjust) / 10)).toBe(
      1005,
    );
    expect(Math.round((percent("descent-override") * sizeAdjust) / 10)).toBe(
      295,
    );
    expect(percent("line-gap-override")).toBe(0);
  });

  it("is offered as the matched sans stack, after Geist and before the system faces", () => {
    expect(tokens).toMatch(
      /--font-sans-matched:\s*"Geist Variable",\s*"Geist Fallback",\s*ui-sans-serif,\s*system-ui,\s*sans-serif;/,
    );
    expect(theme).toContain("--font-sans-matched: var(--font-sans-matched);");
  });
});
