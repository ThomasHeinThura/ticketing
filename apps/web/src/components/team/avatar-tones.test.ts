import { describe, expect, it } from "vitest";
import { AVATAR_TONES } from "./members-table";

// Tailwind v4 default palette (oklch: lightness %, chroma, hue).
const OKLCH: Record<string, [number, number, number]> = {
  "rose-500": [64.5, 0.246, 16.439],
  "rose-700": [51.4, 0.222, 16.935],
  "rose-300": [81, 0.117, 11.638],
  "amber-500": [76.9, 0.188, 70.08],
  "amber-800": [47.3, 0.137, 46.201],
  "amber-300": [87.9, 0.169, 91.605],
  "sky-500": [68.5, 0.169, 237.323],
  "sky-700": [50, 0.134, 242.749],
  "sky-300": [82.8, 0.111, 230.318],
  "emerald-500": [69.6, 0.17, 162.48],
  "emerald-700": [50.8, 0.118, 165.612],
  "emerald-300": [84.5, 0.143, 164.978],
  "violet-500": [60.6, 0.25, 292.717],
  "violet-600": [54.1, 0.281, 293.009],
  "violet-300": [81.1, 0.111, 293.571],
  "indigo-500": [58.5, 0.233, 277.117],
  "indigo-600": [51.1, 0.262, 276.966],
  "indigo-300": [78.5, 0.115, 274.713],
};

/** sRGB channels in 0..1 (gamma-encoded). */
function srgb([l, c, h]: [number, number, number]): number[] {
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);
  const L = l / 100;
  const l3 = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m3 = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s3 = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
  ];
  return linear.map((v) => {
    const clamped = Math.min(1, Math.max(0, v));
    return clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  });
}

const toLinear = (v: number) =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const luminance = (rgb: number[]) =>
  0.2126 * toLinear(rgb[0]) +
  0.7152 * toLinear(rgb[1]) +
  0.0722 * toLinear(rgb[2]);
const over = (fg: number[], bg: number[], alpha: number) =>
  fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_BG = [1, 1, 1];
const DARK_BG = [19 / 255, 19 / 255, 19 / 255]; // ~ neutral-950 + 4% white

describe("member avatar tones", () => {
  it("has 4.5:1 text contrast in light and dark mode for every tone", () => {
    for (const tone of AVATAR_TONES) {
      const bg = tone.match(/bg-(\w+-500)\/15/)?.[1] as string;
      const light = tone.match(/ text-(\w+-\d+) /)?.[1] as string;
      const dark = tone.match(/dark:text-(\w+-\d+)/)?.[1] as string;
      const bgRgb = srgb(OKLCH[bg]);
      expect(
        contrast(srgb(OKLCH[light]), over(bgRgb, LIGHT_BG, 0.15)),
        `${tone} light`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(srgb(OKLCH[dark]), over(bgRgb, DARK_BG, 0.15)),
        `${tone} dark`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
