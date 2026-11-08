/**
 * Shared portal display formats, so the request page, the submission page and the inbox read
 * the same: a file size in B/KB/MB, and a date with time ("Nov 3, 2026, 9:59 PM").
 */
export function formatPortalFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatPortalDateTime(value: string, locale?: string) {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

/**
 * "2 days ago", the same steps as the agent app's `formatRelativeTime`, without importing the
 * app's i18n instance into portal components (the caller passes the portal's locale).
 */
export function formatPortalRelativeTime(
  value: string,
  locale?: string,
  now = new Date(),
) {
  const seconds = Math.round(
    (new Date(value).getTime() - now.getTime()) / 1000,
  );
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, unitSeconds] of RELATIVE_UNITS)
    if (Math.abs(seconds) >= unitSeconds || unit === "second")
      return formatter.format(Math.round(seconds / unitSeconds), unit);
  return formatter.format(0, "second");
}
