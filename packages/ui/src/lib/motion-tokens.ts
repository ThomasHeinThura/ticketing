let cachedDocument: Document | undefined;
const cachedTokens = new Map<string, string>();

function readMotionToken(name: string): string {
  if (typeof document === "undefined") return "";
  if (cachedDocument !== document) {
    cachedDocument = document;
    cachedTokens.clear();
  }
  const cached = cachedTokens.get(name);
  if (cached) return cached;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (value) cachedTokens.set(name, value);
  return value;
}

/** Read the same CSS motion tokens used by utility classes for JS animation APIs. */
export function motionDurationMs(token: "fast" | "base" | "slow"): number {
  if (typeof window === "undefined") return 0;
  const value = readMotionToken(`--duration-${token}`);
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return value.endsWith("ms") ? parsed : parsed * 1000;
}

export function motionEasing(token: "out" | "spring"): string {
  if (typeof window === "undefined") return "linear";
  return readMotionToken(`--ease-${token}`) || "linear";
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
