/** Validate PostgreSQL numeric(20,10) position cursors without converting to JS number. */
export function isValidPositionSortCursorValue(
  value: unknown,
): value is string {
  return (
    typeof value === "string" && /^-?\d{1,10}(?:\.\d{1,10})?$/u.test(value)
  );
}
