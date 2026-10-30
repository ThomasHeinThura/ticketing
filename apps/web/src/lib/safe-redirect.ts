/** Control, whitespace and line-separator characters, which browsers strip or reinterpret. */
function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

/**
 * The `redirect` search value of a sign-in page, accepted only when it is a path on this origin.
 *
 * Rejected: anything that does not start with one `/`, any `//` (protocol-relative), any
 * backslash (browsers read `/\host` as `//host`), any control or whitespace character (browsers
 * strip tabs and newlines, so `/<tab>/host` becomes `//host`) and any `.` or `..` path segment,
 * literal or percent-encoded (`%2e%2e` resolves to `..` when the router builds the URL).
 */
export function getSafeRedirectPath(
  value: string | undefined | null,
): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  if (value.includes("//") || value.includes("\\")) return undefined;
  if (hasUnsafeCharacter(value)) return undefined;
  const path = value.split(/[?#]/u, 1)[0] ?? "";
  if (
    path
      .split("/")
      .map((segment) => segment.replace(/%2e/giu, "."))
      .some((segment) => segment === "." || segment === "..")
  )
    return undefined;
  return value;
}
