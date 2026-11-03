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
