/** Canonical TaskDesk representation for Entra group object ids. */
export function canonicalEntraGroupObjectId(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.toLowerCase();
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(normalized)
    ? normalized
    : undefined;
}
