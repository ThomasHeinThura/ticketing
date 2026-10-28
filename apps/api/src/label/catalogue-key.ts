/** Stable catalogue identifier format used by workspace labels, SLA policies and calendars. */
export const CATALOGUE_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Derive the compatibility default for older clients that do not send a key.
 * Keys are assigned once at creation; callers never recompute them on rename.
 */
export function deriveCatalogueKey(name: string): string | null {
  const base = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return base && CATALOGUE_KEY_PATTERN.test(base) ? base : null;
}

export function resolveCatalogueKey(name: string, key?: string): string | null {
  const resolved = key ?? deriveCatalogueKey(name);
  return resolved && CATALOGUE_KEY_PATTERN.test(resolved) ? resolved : null;
}
