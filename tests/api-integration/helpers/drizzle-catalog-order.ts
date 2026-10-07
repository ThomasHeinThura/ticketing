/**
 * Reorders Drizzle's catalog-inspected tuple values using explicit PostgreSQL
 * key order while preserving the original metadata objects and rejecting any
 * catalog/introspector inventory mismatch.
 */
export function reorderTupleByCatalogKeys<T>(
  metadata: readonly T[],
  catalogKeys: readonly string[],
  keyOf: (item: T) => string,
  context: string,
): T[] {
  const remaining = new Map<string, T>();
  for (const item of metadata) {
    const key = keyOf(item);
    if (remaining.has(key)) {
      throw new Error(`${context}: duplicate introspection tuple key ${key}`);
    }
    remaining.set(key, item);
  }

  if (remaining.size !== catalogKeys.length) {
    throw new Error(
      `${context}: PostgreSQL has ${catalogKeys.length} keys but Drizzle introspection has ${remaining.size}`,
    );
  }

  const ordered = catalogKeys.map((key) => {
    const item = remaining.get(key);
    if (item === undefined) {
      throw new Error(
        `${context}: catalog tuple key ${key} is not introspected`,
      );
    }
    remaining.delete(key);
    return item;
  });

  if (remaining.size > 0) {
    throw new Error(
      `${context}: Drizzle introspection has keys absent from PostgreSQL: ${[...remaining.keys()].join(", ")}`,
    );
  }
  return ordered;
}
