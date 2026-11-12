// Kept in sync with theme.css by motion-tokens.test.ts.
export const motionTokens = {
  fast: "120ms",
  base: "200ms",
  slow: "300ms",
  out: "cubic-bezier(0.23, 1, 0.32, 1)",
  spring:
    "linear(0, 0.044, 0.149, 0.28, 0.417, 0.546, 0.66, 0.755, 0.832, 0.891, 0.935, 0.967, 0.988, 1.002, 1.01, 1.014, 1.015, 1.014, 1.013, 1.011, 1.009, 1.007, 1.005, 1.004, 1)",
} as const;

/** Read static counterparts of the CSS tokens without a render-time style read. */
export function motionDurationMs(token: "fast" | "base" | "slow"): number {
  return Number.parseFloat(motionTokens[token]);
}

export function motionEasing(token: "out" | "spring"): string {
  return motionTokens[token];
}

/** Framer Motion accepts an easing function rather than CSS's sampled linear() curve. */
export function motionEasingFunction(
  token: "spring",
): (progress: number) => number {
  const value = motionEasing(token);
  if (value.startsWith("linear(")) {
    const samples = value.slice(7, -1).split(",").map(Number);
    if (samples.length > 1 && samples.every(Number.isFinite)) {
      return (progress) => {
        const point = Math.max(0, Math.min(1, progress)) * (samples.length - 1);
        const index = Math.floor(point);
        const start = samples[index] ?? progress;
        const end = samples[index + 1] ?? start;
        return start + (end - start) * (point - index);
      };
    }
  }
  // If the stylesheet has not loaded yet, use instant-safe linear interpolation.
  return (progress) => progress;
}

export function motionBezierOut(): [number, number, number, number] | "linear" {
  const match = /^cubic-bezier\(([^)]+)\)$/.exec(motionEasing("out"));
  const values = match?.[1]?.split(",").map(Number);
  return values?.length === 4 && values.every(Number.isFinite)
    ? (values as [number, number, number, number])
    : "linear";
}
