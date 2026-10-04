const units = [
  { seconds: 31_536_000, unit: "year" },
  { seconds: 2_592_000, unit: "month" },
  { seconds: 86_400, unit: "day" },
  { seconds: 3_600, unit: "hour" },
  { seconds: 60, unit: "minute" },
] as const;

export function formatRelativeAge(
  value: string | Date,
  now: Date,
  locale: string,
) {
  const date = value instanceof Date ? value : new Date(value);
  const seconds = Math.round((date.getTime() - now.getTime()) / 1_000);
  if (!Number.isFinite(seconds)) return "";

  const unit = units.find(
    (candidate) => Math.abs(seconds) >= candidate.seconds,
  );
  const selectedUnit = unit ?? { seconds: 1, unit: "second" as const };
  const count = Math.round(seconds / selectedUnit.seconds);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
    count,
    selectedUnit.unit,
  );
}
