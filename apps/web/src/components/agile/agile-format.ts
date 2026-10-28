import type {
  CycleStatus,
  ModuleForecast,
  ModuleState,
  ScopeUnit,
} from "@/fetchers/agile";

/** Minutes as `1w 2d 3h 30m` (a working day is eight hours, a week five days). */
export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";
  const parts: string[] = [];
  let rest = Math.round(minutes);
  for (const [label, size] of [
    ["w", 2400],
    ["d", 480],
    ["h", 60],
    ["m", 1],
  ] as const) {
    const whole = Math.floor(rest / size);
    if (whole > 0) {
      parts.push(`${whole}${label}`);
      rest -= whole * size;
    }
  }
  return parts.join(" ");
}

/** A scope amount in the cycle's unit: points as a number, time as a duration, else a count. */
export function formatScopeAmount(value: number, unit: ScopeUnit): string {
  if (unit === "time") return formatMinutes(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export const CYCLE_STATUS_VARIANT: Record<
  CycleStatus,
  "secondary" | "success" | "outline"
> = {
  upcoming: "outline",
  active: "success",
  completed: "secondary",
};

export const MODULE_STATE_VARIANT: Record<
  ModuleState,
  "secondary" | "success" | "outline" | "warning" | "info"
> = {
  backlog: "outline",
  planned: "outline",
  in_progress: "info",
  paused: "warning",
  completed: "success",
  cancelled: "secondary",
};

export const FORECAST_VARIANT: Record<
  "on_track" | "at_risk" | "late",
  "success" | "warning" | "error"
> = {
  on_track: "success",
  at_risk: "warning",
  late: "error",
};

export function hasForecastRange(
  forecast: ModuleForecast,
): forecast is Extract<ModuleForecast, { earliest: string }> {
  return "earliest" in forecast;
}

/** `YYYY-MM-DD` as a local calendar date without a timezone shift. */
export function formatCalendarDate(value: string, locale?: string): string {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(year, month - 1, day),
  );
}
