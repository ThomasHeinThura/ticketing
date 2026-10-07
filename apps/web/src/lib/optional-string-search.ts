/** Validates optional URL search fields without loading a schema library in the route tree. */
export function parseOptionalStringSearch<
  const Fields extends readonly string[],
>(
  search: Record<string, unknown>,
  fields: Fields,
): Partial<Record<Fields[number], string>> {
  const parsed: Partial<Record<Fields[number], string>> = {};
  for (const field of fields) {
    const value = search[field];
    if (value === undefined) continue;
    if (typeof value !== "string")
      throw new TypeError(`Search parameter ${field} must be a string.`);
    parsed[field as Fields[number]] = value;
  }
  return parsed;
}
