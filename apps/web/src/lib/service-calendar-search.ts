/**
 * The editor's preview year from the URL. Absent or invalid means "the current year", which the
 * screen takes from the server's clock (`useServerToday`), never the browser's.
 */
export function parseCalendarEditorSearch(raw: unknown): { year?: number } {
  const candidate = (raw ?? {}) as Record<string, unknown>;
  const year = Number(candidate.year);
  return Number.isInteger(year) && year >= 1 && year <= 9998 ? { year } : {};
}

export type CalendarEditorSearch = ReturnType<typeof parseCalendarEditorSearch>;
