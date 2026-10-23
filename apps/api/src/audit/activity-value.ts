/** A jsonb `new_value` as the string-or-null `reconstructAt` folds. */
export function activityValueToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}
