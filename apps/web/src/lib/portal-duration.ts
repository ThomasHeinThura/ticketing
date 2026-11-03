/**
 * D4: a duration in the customer's locale with one unit, coarse enough to read at a glance:
 * minutes under an hour, hours under two days, days beyond.
 */
export function formatPortalDuration(seconds: number, locale?: string) {
  const minutes = Math.max(0, seconds) / 60;
  const [value, unit] =
    minutes < 60
      ? [Math.max(1, Math.round(minutes)), "minute"]
      : minutes < 48 * 60
        ? [Math.round((minutes / 60) * 10) / 10, "hour"]
        : [Math.round((minutes / 1440) * 10) / 10, "day"];
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(value);
}
